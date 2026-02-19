import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Friend, PrivateMessage } from '@/types';
import { getChatId, sendPrivateMessage, subscribeToPrivateChat } from '@/services/privateChat';
import { X, Send, User } from 'lucide-react';
import { Button } from '@/components/ui/button'; // Assuming these exist or use standard HTML
import { Input } from '@/components/ui/input'; // Assuming these exist
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface PrivateChatWindowProps {
     friend: Friend;
     onClose: () => void;
}

export const PrivateChatWindow: React.FC<PrivateChatWindowProps> = ({ friend, onClose }) => {
     const { user } = useAuth();
     const [messages, setMessages] = useState<PrivateMessage[]>([]);
     const [newMessage, setNewMessage] = useState('');
     const [loading, setLoading] = useState(true);
     const scrollRef = useRef<HTMLDivElement>(null);

     useEffect(() => {
          if (!user) return;

          const chatId = getChatId(user.id, friend.id);
          const unsubscribe = subscribeToPrivateChat(chatId, (msgs) => {
               setMessages(msgs);
               setLoading(false);
          });

          return () => unsubscribe();
     }, [user, friend.id]);

     useEffect(() => {
          if (scrollRef.current) {
               scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
     }, [messages]);

     const handleSend = async () => {
          if (!user || !newMessage.trim()) return;

          const chatId = getChatId(user.id, friend.id);
          try {
               await sendPrivateMessage(chatId, user.id, newMessage.trim());
               setNewMessage('');
          } catch (error) {
               console.error("Mesaj gonderilemedi", error);
          }
     };

     const handleKeyDown = (e: React.KeyboardEvent) => {
          if (e.key === 'Enter') handleSend();
     };

     return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
               <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden h-[600px] max-h-[90vh]">

                    {/* Header */}
                    <div className="bg-slate-800 p-4 flex items-center justify-between border-b border-slate-700">
                         <div className="flex items-center gap-3">
                              <Avatar className="h-10 w-10 border border-slate-600">
                                   <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${friend.avatar || friend.managerName}`} />
                                   <AvatarFallback><User /></AvatarFallback>
                              </Avatar>
                              <div>
                                   <h3 className="font-bold text-white leading-none">{friend.teamName}</h3>
                                   <p className="text-xs text-slate-400">{friend.managerName}</p>
                              </div>
                         </div>
                         <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                              <X size={24} />
                         </button>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900/50" ref={scrollRef}>
                         {loading ? (
                              <div className="flex items-center justify-center h-full text-slate-500">Yukleniyor...</div>
                         ) : messages.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm opacity-60">
                                   <p>Henuz mesaj yok.</p>
                                   <p>Sohbeti baslat!</p>
                              </div>
                         ) : (
                              messages.map((msg) => {
                                   const isMe = msg.senderId === user?.id;
                                   return (
                                        <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                             <div
                                                  className={`
                      max-w-[75%] px-4 py-2 rounded-2xl text-sm 
                      ${isMe
                                                            ? 'bg-blue-600 text-white rounded-br-none'
                                                            : 'bg-slate-700 text-slate-200 rounded-bl-none'}
                    `}
                                             >
                                                  {msg.text}
                                                  {/* Time can be added here if needed */}
                                             </div>
                                        </div>
                                   );
                              })
                         )}
                    </div>

                    {/* Input Area */}
                    <div className="p-3 bg-slate-800 border-t border-slate-700 flex gap-2">
                         <Input
                              value={newMessage}
                              onChange={(e) => setNewMessage(e.target.value)}
                              onKeyDown={handleKeyDown}
                              placeholder="Bir mesaj yaz..."
                              className="bg-slate-900 border-slate-600 text-white placeholder:text-slate-500 focus-visible:ring-blue-500"
                         />
                         <Button onClick={handleSend} size="icon" className="bg-blue-600 hover:bg-blue-500 text-white">
                              <Send size={18} />
                         </Button>
                    </div>
               </div>
          </div>
     );
};
