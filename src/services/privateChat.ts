import {
     collection,
     addDoc,
     query,
     orderBy,
     onSnapshot,
     serverTimestamp,
     limit,
     doc,
     setDoc,
     updateDoc,
     getDoc,
     where
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { PrivateMessage } from '@/types';

// Sohbet ID oluşturucu (İki kullanıcı ID'sini alfabetik sıraya göre birleştirir)
export const getChatId = (user1: string, user2: string) => {
     return [user1, user2].sort().join('_');
};

// Mesaj Gönder
export const sendPrivateMessage = async (chatId: string, senderId: string, text: string) => {
     const messagesRef = collection(db, `private_chats/${chatId}/messages`);

     // 1. Mesajı ekle
     await addDoc(messagesRef, {
          text,
          senderId,
          createdAt: serverTimestamp(),
          read: false
     });

     // 2. Sohbet meta verisini güncelle (Bildirimler için)
     const participants = chatId.split('_');
     const receiverId = participants.find(id => id !== senderId);

     if (receiverId) {
          await updateChatMetadata(chatId, senderId, receiverId, text);
     }
};

// Sohbet Meta Verisini Güncelle (Last Message & Unread Count)
const updateChatMetadata = async (chatId: string, senderId: string, receiverId: string, lastMessage: string) => {
     try {
          const chatRef = doc(db, 'private_chats', chatId);
          const chatDoc = await getDoc(chatRef);

          if (!chatDoc.exists()) {
               // Yeni sohbet başlatılıyor
               await setDoc(chatRef, {
                    participants: [senderId, receiverId],
                    lastMessage,
                    lastMessageTime: serverTimestamp(),
                    unreadCounts: {
                         [senderId]: 0,
                         [receiverId]: 1
                    }
               });
          } else {
               // Mevcut sohbeti güncelle
               const currentData = chatDoc.data();
               const currentUnread = currentData.unreadCounts?.[receiverId] || 0;

               await updateDoc(chatRef, {
                    lastMessage,
                    lastMessageTime: serverTimestamp(),
                    [`unreadCounts.${receiverId}`]: currentUnread + 1
               });
          }
     } catch (error) {
          console.error('[privateChat] Metadata update failed:', error);
     }
}

// Sohbeti Okundu Olarak İşaretle
export const markChatAsRead = async (chatId: string, userId: string) => {
     const chatRef = doc(db, 'private_chats', chatId);
     // Sadece kendi okunmamış sayısını sıfırla
     await updateDoc(chatRef, {
          [`unreadCounts.${userId}`]: 0
     });
};

// Okunmamış Sohbetleri Dinle (TopBar bildirimi için)
export const subscribeToUnreadChats = (userId: string, callback: (unreadChats: any[]) => void) => {
     const chatsRef = collection(db, 'private_chats');
     // Katılımcısı olduğum sohbetleri getir
     const q = query(chatsRef, where('participants', 'array-contains', userId));

     return onSnapshot(q, (snapshot) => {
          const unreadChats = snapshot.docs
               .map(doc => ({ id: doc.id, ...doc.data() }))
               // Sadece benim için okunmamış mesajı olanları filtrele
               .filter((chat: any) => (chat.unreadCounts?.[userId] || 0) > 0);

          callback(unreadChats);
     });
};

// Sohbet Dinle
export const subscribeToPrivateChat = (chatId: string, callback: (messages: PrivateMessage[]) => void) => {
     const messagesRef = collection(db, `private_chats/${chatId}/messages`);
     const q = query(messagesRef, orderBy('createdAt', 'asc'), limit(50));

     return onSnapshot(q, (snapshot) => {
          const messages = snapshot.docs.map(doc => {
               const data = doc.data();
               return {
                    id: doc.id,
                    text: data.text,
                    senderId: data.senderId,
                    createdAt: data.createdAt?.toDate() || new Date(),
                    read: data.read
               } as PrivateMessage;
          });
          callback(messages);
     });
};
