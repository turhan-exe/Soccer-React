import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
     getFriends,
     removeFriend,
     searchUsers,
     sendFriendRequest,
     getFriendRequests,
     acceptFriendRequest,
     rejectFriendRequest,
     checkFriendStatus
} from '@/services/friends';
import { Friend, User, FriendRequest } from '@/types';
import { PrivateChatWindow } from '@/components/chat/PrivateChatWindow';
import { toast } from 'sonner';
import {
     Users,
     UserPlus,
     Search,
     MessageCircle,
     Swords,
     Trash2,
     ArrowLeft,
     Inbox,
     Check,
     X,
     Clock
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { markChatAsRead, getChatId } from '@/services/privateChat';

// Arama sonuçları için genişletilmiş tip
interface SearchResultUser extends User {
     friendStatus?: 'none' | 'friend' | 'request_sent' | 'request_received';
}

export default function FriendsPage() {
     const { user } = useAuth();
     const navigate = useNavigate();
     const [searchParams] = useSearchParams();
     const [friends, setFriends] = useState<Friend[]>([]);
     const [requests, setRequests] = useState<FriendRequest[]>([]);
     const [searchResults, setSearchResults] = useState<SearchResultUser[]>([]);
     const [searchQuery, setSearchQuery] = useState('');
     const [selectedFriendForChat, setSelectedFriendForChat] = useState<Friend | null>(null);
     const [loading, setLoading] = useState(false);

     const loadData = async () => {
          if (!user) return;
          try {
               const [friendsData, requestsData] = await Promise.all([
                    getFriends(user.id),
                    getFriendRequests(user.id)
               ]);
               setFriends(friendsData);
               setRequests(requestsData);
          } catch (error) {
               console.error("Veriler yuklenemedi", error);
               toast.error("Veriler yuklenirken hata olustu.");
          }
     };

     useEffect(() => {
          loadData();
     }, [user]);

     // URL'den chatWith parametresini kontrol et
     useEffect(() => {
          if (!user || friends.length === 0) return;

          const chatWithId = searchParams.get('chatWith');
          if (chatWithId) {
               const friend = friends.find(f => f.id === chatWithId);
               if (friend) {
                    setSelectedFriendForChat(friend);
                    // Bildirime tıklandığı için okundu olarak işaretle
                    const chatId = getChatId(user.id, friend.id);
                    markChatAsRead(chatId, user.id);
               }
          }
     }, [searchParams, friends, user]);

     // Arkadaş Arama
     const handleSearch = async () => {
          if (!user || !searchQuery.trim()) return;
          setLoading(true);
          try {
               const results = await searchUsers(searchQuery, user.id);

               // Her sonuç için arkadaşlık durumunu kontrol et
               const resultsWithStatus = await Promise.all(results.map(async (resUser) => {
                    // Kendisiyle arkadaş olamaz/istek atamaz
                    if (resUser.id === user.id) return { ...resUser, friendStatus: 'none' as const };

                    const status = await checkFriendStatus(user.id, resUser.id);
                    return { ...resUser, friendStatus: status };
               }));

               setSearchResults(resultsWithStatus);

               if (resultsWithStatus.length === 0) {
                    toast.info("Kullanici bulunamadi.");
               }
          } catch (error) {
               console.error(error);
               const msg = (error as any)?.message || 'Bilinmeyen hata';
               window.alert(`MOBIL HATA DETAYI:\n${msg}`);
               toast.error(`Arama hatasi: ${msg}`);
          } finally {
               setLoading(false);
          }
     };

     // İstek Gönder
     const handleSendRequest = async (targetUser: User) => {
          if (!user) return;
          try {
               await sendFriendRequest(user, targetUser);
               toast.success("Arkadaslik istegi gonderildi!");

               // UI güncelle
               setSearchResults(prev => prev.map(u =>
                    u.id === targetUser.id ? { ...u, friendStatus: 'request_sent' } : u
               ));
          } catch (error) {
               console.error(error);
               toast.error("Istek gonderilirken hata olustu.");
          }
     };

     // İsteği Kabul Et
     const handleAcceptRequest = async (request: FriendRequest) => {
          if (!user) return;
          try {
               const senderUser = {
                    id: request.senderId,
                    teamName: request.senderName,
                    managerName: request.senderManager,
                    avatar: request.senderAvatar
               };

               await acceptFriendRequest(request.id, senderUser, user);
               toast.success("Arkadaslik istegi kabul edildi!");
               loadData(); // Listeleri yenile
          } catch (error) {
               console.error(error);
               toast.error("Istek kabul edilirken hata olustu.");
          }
     };

     // İsteği Reddet
     const handleRejectRequest = async (requestId: string) => {
          if (!confirm("Bu istegi reddetmek istedigine emin misin?")) return;
          try {
               await rejectFriendRequest(requestId);
               toast.info("Istek reddedildi.");
               setRequests(prev => prev.filter(r => r.id !== requestId));
          } catch (error) {
               console.error(error);
               toast.error("Islem basarisiz.");
          }
     };

     // Arkadaş Silme
     const handleRemoveFriend = async (friendId: string, friendName: string) => {
          if (!user) return;
          if (!confirm(`${friendName} adli arkadasi silmek istedigine emin misin?`)) return;

          try {
               await removeFriend(user.id, friendId);
               toast.success("Arkadas silindi.");
               loadData();
          } catch (error) {
               toast.error("Silme islemi basarisiz.");
          }
     };

     // Dostluk Maçı (Milestone 1 - Native Connection Test)
     const handleFriendlyMatch = (friendName: string) => {
          // Toast mesajı yerine doğrudan sayfaya yönlendiriyoruz
          navigate('/friendly-match');
     };

     // Chat Açma ve Okundu İşaretleme
     const handleOpenChat = (friend: Friend) => {
          setSelectedFriendForChat(friend);
          if (user) {
               const chatId = getChatId(user.id, friend.id);
               markChatAsRead(chatId, user.id);
          }
     };

     return (
          <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-6 pb-24">
               {/* Header */}
               <div className="flex items-center gap-4 mb-6">
                    <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="text-slate-400 hover:text-white">
                         <ArrowLeft size={24} />
                    </Button>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                         Sosyal Merkez
                    </h1>
               </div>

               <div className="max-w-4xl mx-auto">
                    <Tabs defaultValue="list" className="w-full">
                         <TabsList className="grid w-full grid-cols-3 bg-slate-900 p-1 rounded-xl mb-6">
                              <TabsTrigger value="list" className="data-[state=active]:bg-slate-800 data-[state=active]:text-white text-slate-400 py-3 rounded-lg transition-all">
                                   <Users className="w-4 h-4 mr-2" />
                                   <span className="hidden sm:inline">Arkadaslar</span>
                                   <span className="sm:hidden">({friends.length})</span>
                                   <span className="hidden sm:inline ml-1">({friends.length})</span>
                              </TabsTrigger>
                              <TabsTrigger value="requests" className="data-[state=active]:bg-slate-800 data-[state=active]:text-white text-slate-400 py-3 rounded-lg transition-all relative">
                                   <Inbox className="w-4 h-4 mr-2" />
                                   <span className="hidden sm:inline">Istekler</span>
                                   {requests.length > 0 && (
                                        <Badge className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 h-5 w-5 p-0 flex items-center justify-center rounded-full text-[10px]">
                                             {requests.length}
                                        </Badge>
                                   )}
                              </TabsTrigger>
                              <TabsTrigger value="add" className="data-[state=active]:bg-slate-800 data-[state=active]:text-white text-slate-400 py-3 rounded-lg transition-all">
                                   <UserPlus className="w-4 h-4 mr-2" />
                                   <span className="hidden sm:inline">Ekle</span>
                                   <span className="sm:hidden">Ara</span>
                              </TabsTrigger>
                         </TabsList>

                         {/* ARKADAŞ LİSTESİ */}
                         <TabsContent value="list" className="mt-0">
                              {friends.length === 0 ? (
                                   <div className="text-center py-12 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
                                        <Users className="w-12 h-12 mx-auto text-slate-600 mb-4" />
                                        <h3 className="text-lg font-medium text-slate-300">Henuz arkadasin yok</h3>
                                        <p className="text-slate-500 mt-1">Diger menajerleri ekleyerek rekabete basla!</p>
                                   </div>
                              ) : (
                                   <div className="grid gap-4 sm:grid-cols-2">
                                        {friends.map((friend) => (
                                             <Card key={friend.id} className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-all">
                                                  <CardContent className="p-4 flex items-center gap-4">
                                                       <Avatar className="h-12 w-12 border-2 border-slate-700">
                                                            <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${friend.avatar || friend.managerName}`} />
                                                            <AvatarFallback className="bg-slate-800 text-slate-400">{friend.teamName.substring(0, 2)}</AvatarFallback>
                                                       </Avatar>

                                                       <div className="flex-1 min-w-0">
                                                            <h4 className="font-bold text-slate-200 truncate">{friend.teamName}</h4>
                                                            <p className="text-xs text-slate-500 truncate">{friend.managerName}</p>
                                                       </div>

                                                       <div className="flex flex-col gap-2">
                                                            <div className="flex gap-2">
                                                                 <Button
                                                                      size="icon"
                                                                      variant="secondary"
                                                                      className="h-8 w-8 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                                                                      onClick={() => handleOpenChat(friend)}
                                                                      title="Mesaj Gonder"
                                                                 >
                                                                      <MessageCircle size={14} />
                                                                 </Button>
                                                                 <Button
                                                                      size="icon"
                                                                      variant="secondary"
                                                                      className="h-8 w-8 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                                                      onClick={() => handleFriendlyMatch(friend.teamName)}
                                                                      title="Dostluk Maci"
                                                                 >
                                                                      <Swords size={14} />
                                                                 </Button>
                                                            </div>
                                                            <Button
                                                                 size="icon"
                                                                 variant="ghost"
                                                                 className="h-6 w-full text-slate-600 hover:text-red-400 hover:bg-red-950/30"
                                                                 onClick={() => handleRemoveFriend(friend.id, friend.teamName)}
                                                                 title="Arkadasi Sil"
                                                            >
                                                                 <Trash2 size={12} />
                                                            </Button>
                                                       </div>
                                                  </CardContent>
                                             </Card>
                                        ))}
                                   </div>
                              )}
                         </TabsContent>

                         {/* GELEN İSTEKLER */}
                         <TabsContent value="requests" className="mt-0">
                              {requests.length === 0 ? (
                                   <div className="text-center py-12 bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed">
                                        <Inbox className="w-12 h-12 mx-auto text-slate-600 mb-4" />
                                        <h3 className="text-lg font-medium text-slate-300">Bekleyen istek yok</h3>
                                        <p className="text-slate-500 mt-1">Yeni arkadaşlık istekleri burada görünecek.</p>
                                   </div>
                              ) : (
                                   <div className="space-y-3">
                                        {requests.map((request) => (
                                             <div key={request.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-900 border border-slate-800">
                                                  <div className="flex items-center gap-3">
                                                       <Avatar className="h-10 w-10 border border-slate-700">
                                                            <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${request.senderAvatar || request.senderManager}`} />
                                                            <AvatarFallback>U</AvatarFallback>
                                                       </Avatar>
                                                       <div>
                                                            <p className="font-bold text-slate-200">{request.senderName}</p>
                                                            <p className="text-xs text-slate-500">Menajer: {request.senderManager}</p>
                                                            <p className="text-[10px] text-slate-600 mt-1">{new Date(request.createdAt).toLocaleDateString()}</p>
                                                       </div>
                                                  </div>
                                                  <div className="flex gap-2">
                                                       <Button
                                                            size="sm"
                                                            onClick={() => handleAcceptRequest(request)}
                                                            className="bg-emerald-600 hover:bg-emerald-500 text-white"
                                                       >
                                                            <Check size={16} className="mr-1" /> Kabul
                                                       </Button>
                                                       <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => handleRejectRequest(request.id)}
                                                            className="border-red-500/30 text-red-500 hover:bg-red-500/10"
                                                       >
                                                            <X size={16} />
                                                       </Button>
                                                  </div>
                                             </div>
                                        ))}
                                   </div>
                              )}
                         </TabsContent>

                         {/* ARKADAŞ EKLEME / ARAMA */}
                         <TabsContent value="add" className="mt-0 space-y-6">
                              <div className="flex gap-2">
                                   <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
                                        <Input
                                             placeholder="Takim Adi veya Menajer Adi..."
                                             className="pl-10 bg-slate-900 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-purple-500"
                                             value={searchQuery}
                                             onChange={(e) => setSearchQuery(e.target.value)}
                                             onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                        />
                                   </div>
                                   <Button onClick={handleSearch} disabled={loading} className="bg-purple-600 hover:bg-purple-500 text-white">
                                        {loading ? 'Araniyor...' : 'Ara'}
                                   </Button>
                              </div>

                              <div className="space-y-4">
                                   {searchResults.length > 0 && (
                                        <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Sonuclar</h3>
                                   )}

                                   <div className="grid gap-3">
                                        {searchResults.map((result) => (
                                             <div key={result.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-900 border border-slate-800">
                                                  <div className="flex items-center gap-3">
                                                       <Avatar className="h-10 w-10 border border-slate-700">
                                                            <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${result.username || result.teamName}`} />
                                                            <AvatarFallback>U</AvatarFallback>
                                                       </Avatar>
                                                       <div>
                                                            <p className="font-bold text-slate-200">{result.teamName}</p>
                                                            <p className="text-xs text-slate-500">{result.username}</p>
                                                       </div>
                                                  </div>

                                                  {/* Duruma göre buton */}
                                                  {result.friendStatus === 'friend' ? (
                                                       <Button size="sm" disabled variant="outline" className="border-slate-700 text-slate-500">
                                                            <Check size={14} className="mr-2" /> Arkadaşsınız
                                                       </Button>
                                                  ) : result.friendStatus === 'request_sent' ? (
                                                       <Button size="sm" disabled variant="outline" className="border-slate-700 text-slate-500">
                                                            <Clock size={14} className="mr-2" /> İstek Gönderildi
                                                       </Button>
                                                  ) : result.friendStatus === 'request_received' ? (
                                                       <Button size="sm" disabled variant="outline" className="border-slate-700 text-slate-500">
                                                            <Inbox size={14} className="mr-2" /> İstek Geldi
                                                       </Button>
                                                  ) : result.friendStatus === 'none' ? (
                                                       result.id === user?.id ? (
                                                            <span className="text-xs text-slate-600 italic">Siz</span>
                                                       ) : (
                                                            <Button
                                                                 size="sm"
                                                                 variant="ghost"
                                                                 className="bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20"
                                                                 onClick={() => handleSendRequest(result)}
                                                            >
                                                                 <UserPlus size={16} className="mr-2" />
                                                                 İstek Gönder
                                                            </Button>
                                                       )
                                                  ) : null}
                                             </div>
                                        ))}
                                   </div>
                              </div>
                         </TabsContent>
                    </Tabs>
               </div>

               {/* Chat Windows would go here or be global */}
               {selectedFriendForChat && (
                    <PrivateChatWindow
                         friend={selectedFriendForChat}
                         onClose={() => setSelectedFriendForChat(null)}
                    />
               )}
          </div>
     );
}
