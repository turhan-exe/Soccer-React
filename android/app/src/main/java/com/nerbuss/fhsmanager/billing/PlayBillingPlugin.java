package com.nerbuss.fhsmanager.billing;

import android.text.TextUtils;
import android.util.Log;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

@CapacitorPlugin(name = "PlayBilling")
public class PlayBillingPlugin extends Plugin implements PurchasesUpdatedListener {
  private static final String TAG = "PlayBillingPlugin";

  private BillingClient billingClient;
  private final Map<String, ProductDetails> cachedProducts = new LinkedHashMap<>();
  private final List<PendingReadyRequest> pendingReadyRequests = new ArrayList<>();
  private boolean isConnecting = false;
  private String pendingPurchaseCallId;
  private String pendingPurchaseProductId;

  @Override
  public void load() {
    super.load();
    createBillingClientIfNeeded();
  }

  @Override
  protected void handleOnDestroy() {
    if (billingClient != null) {
      billingClient.endConnection();
      billingClient = null;
    }
    pendingReadyRequests.clear();
    cachedProducts.clear();
    pendingPurchaseCallId = null;
    pendingPurchaseProductId = null;
    super.handleOnDestroy();
  }

  @PluginMethod
  public void listProducts(PluginCall call) {
    JSArray rawIds = call.getArray("productIds");
    List<String> productIds = sanitizeProductIds(rawIds);
    if (productIds.isEmpty()) {
      call.reject("productIds required");
      return;
    }

    ensureBillingReady(
        () -> queryProductsInternal(productIds, details -> call.resolve(buildProductListResult(details)), error -> call.reject(error)),
        error -> call.reject(error));
  }

  @PluginMethod
  public void purchase(PluginCall call) {
    String productId = trim(call.getString("productId"));
    if (productId.isEmpty()) {
      call.reject("productId required");
      return;
    }

    if (pendingPurchaseCallId != null) {
      call.reject("purchase_already_in_progress");
      return;
    }

    if (getActivity() == null) {
      call.reject("activity_unavailable");
      return;
    }

    getBridge().saveCall(call);
    pendingPurchaseCallId = call.getCallbackId();
    pendingPurchaseProductId = productId;

    ensureBillingReady(
        () -> ensureProductDetail(
            productId,
            detail -> launchBillingFlow(call, detail),
            error -> rejectPendingPurchase(error)),
        error -> rejectPendingPurchase(error));
  }

  @PluginMethod
  public void listOwnedPurchases(PluginCall call) {
    ensureBillingReady(
        () ->
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build(),
                (billingResult, purchases) -> {
                  if (!isOk(billingResult)) {
                    call.reject(formatBillingError("query_purchases_failed", billingResult));
                    return;
                  }

                  JSObject result = new JSObject();
                  JSArray out = new JSArray();
                  if (purchases != null) {
                    for (Purchase purchase : purchases) {
                      out.put(toPurchaseJson(purchase));
                    }
                  }
                  result.put("purchases", out);
                  call.resolve(result);
                }),
        error -> call.reject(error));
  }

  @PluginMethod
  public void consumePurchase(PluginCall call) {
    String purchaseToken = trim(call.getString("purchaseToken"));
    if (purchaseToken.isEmpty()) {
      call.reject("purchaseToken required");
      return;
    }

    ensureBillingReady(
        () ->
            billingClient.consumeAsync(
                ConsumeParams.newBuilder().setPurchaseToken(purchaseToken).build(),
                (billingResult, token) -> {
                  if (!isOk(billingResult)) {
                    call.reject(formatBillingError("consume_failed", billingResult));
                    return;
                  }

                  JSObject result = new JSObject();
                  result.put("ok", true);
                  result.put("purchaseToken", token);
                  call.resolve(result);
                }),
        error -> call.reject(error));
  }

  @Override
  public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
    JSObject eventPayload = new JSObject();
    eventPayload.put("responseCode", billingResult.getResponseCode());
    eventPayload.put("debugMessage", billingResult.getDebugMessage());

    if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
      eventPayload.put("status", "cancelled");
      notifyListeners("billingPurchaseUpdated", eventPayload, true);
      resolvePendingPurchase(eventPayload);
      return;
    }

    if (!isOk(billingResult)) {
      eventPayload.put("status", "error");
      notifyListeners("billingPurchaseUpdated", eventPayload, true);
      rejectPendingPurchase(formatBillingError("purchase_failed", billingResult));
      return;
    }

    Purchase matchingPurchase = findMatchingPurchase(purchases, pendingPurchaseProductId);
    if (matchingPurchase == null) {
      eventPayload.put("status", "error");
      notifyListeners("billingPurchaseUpdated", eventPayload, true);
      rejectPendingPurchase("purchase_not_found");
      return;
    }

    JSObject purchaseJson = toPurchaseJson(matchingPurchase);
    notifyListeners("billingPurchaseUpdated", purchaseJson, true);
    resolvePendingPurchase(purchaseJson);
  }

  private void createBillingClientIfNeeded() {
    if (billingClient != null) {
      return;
    }

    billingClient =
        BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
  }

  private void ensureBillingReady(Runnable onReady, Consumer<String> onError) {
    createBillingClientIfNeeded();

    if (billingClient != null && billingClient.isReady()) {
      onReady.run();
      return;
    }

    pendingReadyRequests.add(new PendingReadyRequest(onReady, onError));
    if (isConnecting || billingClient == null) {
      return;
    }

    isConnecting = true;
    billingClient.startConnection(
        new BillingClientStateListener() {
          @Override
          public void onBillingSetupFinished(BillingResult billingResult) {
            isConnecting = false;

            List<PendingReadyRequest> requests = new ArrayList<>(pendingReadyRequests);
            pendingReadyRequests.clear();

            if (!isOk(billingResult)) {
              String error = formatBillingError("billing_setup_failed", billingResult);
              for (PendingReadyRequest request : requests) {
                request.onError.accept(error);
              }
              return;
            }

            for (PendingReadyRequest request : requests) {
              request.onReady.run();
            }
          }

          @Override
          public void onBillingServiceDisconnected() {
            isConnecting = false;
            Log.w(TAG, "Billing service disconnected");
          }
        });
  }

  private void ensureProductDetail(
      String productId,
      Consumer<ProductDetails> onReady,
      Consumer<String> onError) {
    ProductDetails cached = cachedProducts.get(productId);
    if (cached != null) {
      onReady.accept(cached);
      return;
    }

    queryProductsInternal(
        Collections.singletonList(productId),
        details -> {
          if (details.isEmpty()) {
            onError.accept("product_not_found");
            return;
          }
          onReady.accept(details.get(0));
        },
        onError);
  }

  private void queryProductsInternal(
      List<String> productIds,
      Consumer<List<ProductDetails>> onReady,
      Consumer<String> onError) {
    List<QueryProductDetailsParams.Product> products = new ArrayList<>();
    for (String productId : productIds) {
      products.add(
          QueryProductDetailsParams.Product.newBuilder()
              .setProductId(productId)
              .setProductType(BillingClient.ProductType.INAPP)
              .build());
    }

    QueryProductDetailsParams params =
        QueryProductDetailsParams.newBuilder().setProductList(products).build();

    billingClient.queryProductDetailsAsync(
        params,
        (billingResult, queryResult) -> {
          if (!isOk(billingResult)) {
            onError.accept(formatBillingError("query_products_failed", billingResult));
            return;
          }

          List<ProductDetails> safeList =
              queryResult == null || queryResult.getProductDetailsList() == null
                  ? Collections.emptyList()
                  : queryResult.getProductDetailsList();
          for (ProductDetails product : safeList) {
            cachedProducts.put(product.getProductId(), product);
          }
          onReady.accept(safeList);
        });
  }

  private void launchBillingFlow(PluginCall call, ProductDetails productDetails) {
    BillingFlowParams.ProductDetailsParams productDetailsParams =
        BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(productDetails)
            .build();

    BillingFlowParams.Builder flowBuilder =
        BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(Collections.singletonList(productDetailsParams));

    String obfuscatedAccountId = trim(call.getString("obfuscatedAccountId"));
    if (!obfuscatedAccountId.isEmpty()) {
      flowBuilder.setObfuscatedAccountId(obfuscatedAccountId);
    }

    String obfuscatedProfileId = trim(call.getString("obfuscatedProfileId"));
    if (!obfuscatedProfileId.isEmpty()) {
      flowBuilder.setObfuscatedProfileId(obfuscatedProfileId);
    }

    BillingResult launchResult = billingClient.launchBillingFlow(getActivity(), flowBuilder.build());
    if (!isOk(launchResult)) {
      rejectPendingPurchase(formatBillingError("launch_billing_flow_failed", launchResult));
    }
  }

  private void resolvePendingPurchase(JSObject payload) {
    PluginCall call = pendingPurchaseCallId == null ? null : getBridge().getSavedCall(pendingPurchaseCallId);
    pendingPurchaseCallId = null;
    pendingPurchaseProductId = null;

    if (call == null) {
      return;
    }

    call.resolve(payload);
  }

  private void rejectPendingPurchase(String error) {
    PluginCall call = pendingPurchaseCallId == null ? null : getBridge().getSavedCall(pendingPurchaseCallId);
    pendingPurchaseCallId = null;
    pendingPurchaseProductId = null;

    if (call == null) {
      return;
    }

    call.reject(error);
  }

  private static Purchase findMatchingPurchase(List<Purchase> purchases, String productId) {
    if (purchases == null || purchases.isEmpty()) {
      return null;
    }

    if (TextUtils.isEmpty(productId)) {
      return purchases.get(0);
    }

    for (Purchase purchase : purchases) {
      List<String> products = purchase.getProducts();
      if (products != null && products.contains(productId)) {
        return purchase;
      }
    }

    return purchases.get(0);
  }

  private static JSObject buildProductListResult(List<ProductDetails> productDetailsList) {
    JSArray products = new JSArray();
    for (ProductDetails product : productDetailsList) {
      products.put(toProductJson(product));
    }

    JSObject result = new JSObject();
    result.put("products", products);
    return result;
  }

  private static JSObject toProductJson(ProductDetails product) {
    JSObject out = new JSObject();
    out.put("productId", product.getProductId());
    out.put("title", product.getTitle());
    out.put("description", product.getDescription());

    ProductDetails.OneTimePurchaseOfferDetails oneTime = product.getOneTimePurchaseOfferDetails();
    if (oneTime != null) {
      out.put("formattedPrice", oneTime.getFormattedPrice());
      out.put("priceCurrencyCode", oneTime.getPriceCurrencyCode());
      out.put("priceAmountMicros", oneTime.getPriceAmountMicros());
    }

    return out;
  }

  private static JSObject toPurchaseJson(Purchase purchase) {
    JSObject out = new JSObject();
    String status = "unknown";
    if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
      status = "purchased";
    } else if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) {
      status = "pending";
    }

    List<String> products = purchase.getProducts();
    out.put("status", status);
    out.put("productId", products != null && !products.isEmpty() ? products.get(0) : "");
    out.put("products", new JSArray(products == null ? Collections.emptyList() : products));
    out.put("orderId", purchase.getOrderId());
    out.put("packageName", purchase.getPackageName());
    out.put("purchaseToken", purchase.getPurchaseToken());
    out.put("purchaseState", purchaseStateName(purchase.getPurchaseState()));
    out.put("acknowledged", purchase.isAcknowledged());
    out.put("autoRenewing", purchase.isAutoRenewing());
    out.put("quantity", purchase.getQuantity());
    out.put("developerPayload", purchase.getDeveloperPayload());
    out.put("signature", purchase.getSignature());
    out.put("originalJson", purchase.getOriginalJson());
    out.put("purchaseTime", purchase.getPurchaseTime());
    return out;
  }

  private static String purchaseStateName(int purchaseState) {
    if (purchaseState == Purchase.PurchaseState.PURCHASED) {
      return "PURCHASED";
    }
    if (purchaseState == Purchase.PurchaseState.PENDING) {
      return "PENDING";
    }
    return "UNSPECIFIED_STATE";
  }

  private static boolean isOk(BillingResult billingResult) {
    return billingResult != null
        && billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK;
  }

  private static String formatBillingError(String prefix, BillingResult billingResult) {
    if (billingResult == null) {
      return prefix + ":unknown";
    }
    return prefix
        + ":"
        + billingResult.getResponseCode()
        + ":"
        + trim(billingResult.getDebugMessage());
  }

  private static List<String> sanitizeProductIds(JSArray rawIds) {
    if (rawIds == null || rawIds.length() == 0) {
      return Collections.emptyList();
    }

    List<String> productIds = new ArrayList<>();
    for (int i = 0; i < rawIds.length(); i++) {
      String productId = trim(rawIds.optString(i, ""));
      if (!productId.isEmpty() && !productIds.contains(productId)) {
        productIds.add(productId);
      }
    }
    return productIds;
  }

  private static String trim(String raw) {
    return raw == null ? "" : raw.trim();
  }

  private static final class PendingReadyRequest {
    private final Runnable onReady;
    private final Consumer<String> onError;

    private PendingReadyRequest(Runnable onReady, Consumer<String> onError) {
      this.onReady = onReady;
      this.onError = onError;
    }
  }
}
