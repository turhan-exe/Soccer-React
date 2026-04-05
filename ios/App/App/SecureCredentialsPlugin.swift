import Foundation
import Security
import Capacitor

@objc(SecureCredentialsPlugin)
public class SecureCredentialsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureCredentialsPlugin"
    public let jsName = "SecureCredentials"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.nerbuss.fhsmanager.securecredentials"
    private let account = "remembered_credentials"

    @objc func get(_ call: CAPPluginCall) {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }

        guard status == errSecSuccess else {
            call.reject("secure_storage_unavailable")
            return
        }

        guard
            let data = item as? Data,
            let value = String(data: data, encoding: .utf8)
        else {
            call.resolve(["value": NSNull()])
            return
        }

        call.resolve(["value": value])
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let value = call.getString("value"), !value.isEmpty else {
            call.reject("missing_value")
            return
        }

        clearStoredValue()

        var query = baseQuery()
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            call.reject("secure_storage_unavailable")
            return
        }

        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        clearStoredValue()
        call.resolve()
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private func clearStoredValue() {
        SecItemDelete(baseQuery() as CFDictionary)
    }
}
