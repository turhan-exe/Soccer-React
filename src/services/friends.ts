import {
     collection,
     doc,
     getDoc,
     getDocs,
     setDoc,
     deleteDoc,
     addDoc,
     query,
     where,
     limit,
     updateDoc,
     or,
     and
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import { Friend, User, ClubTeam, FriendRequest } from '@/types';

// --- MEVCUT FONKSİYONLAR (GÜNCELLENDİ) ---

// Arkadaşları Getirme
export const getFriends = async (userId: string): Promise<Friend[]> => {
     const q = collection(db, `users/${userId}/friends`);
     const snapshot = await getDocs(q);
     return snapshot.docs.map(doc => doc.data() as Friend);
};

// Arkadaş Silme
export const removeFriend = async (currentUserId: string, friendId: string) => {
     await deleteDoc(doc(db, `users/${currentUserId}/friends/${friendId}`));
     await deleteDoc(doc(db, `users/${friendId}/friends/${currentUserId}`));
};

// --- YENİ ARKADAŞLIK İSTEĞİ SİSTEMİ ---

// İstek Gönder
export const sendFriendRequest = async (currentUser: User, targetUser: User) => {
     const requestsRef = collection(db, 'friend_requests');

     // Zaten bekleyen bir istek var mı kontrol et
     // Hem ben ona, hem o bana göndermiş olabilir
     const q = query(
          requestsRef,
          or(
               and(where('senderId', '==', currentUser.id), where('receiverId', '==', targetUser.id), where('status', '==', 'pending')),
               and(where('senderId', '==', targetUser.id), where('receiverId', '==', currentUser.id), where('status', '==', 'pending'))
          )
     );

     const existingDocs = await getDocs(q);
     if (!existingDocs.empty) {
          throw new Error("Zaten bekleyen bir istek var.");
     }

     const newRequest: Omit<FriendRequest, 'id'> = {
          senderId: currentUser.id,
          senderName: currentUser.teamName,
          senderManager: currentUser.username,
          senderAvatar: currentUser.username || currentUser.teamName,
          receiverId: targetUser.id,
          status: 'pending',
          createdAt: new Date().toISOString()
     };

     await addDoc(requestsRef, newRequest);
};

// Gelen İstekleri Getir
export const getFriendRequests = async (userId: string): Promise<FriendRequest[]> => {
     const requestsRef = collection(db, 'friend_requests');
     const q = query(
          requestsRef,
          where('receiverId', '==', userId),
          where('status', '==', 'pending')
     );

     const snapshot = await getDocs(q);
     return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FriendRequest));
};

// İsteği Kabul Et
export const acceptFriendRequest = async (requestId: string, sender: { id: string, teamName: string, managerName: string, avatar: string }, receiver: User) => {
     // 1. İsteği güncelle
     const requestRef = doc(db, 'friend_requests', requestId);
     await updateDoc(requestRef, { status: 'accepted' });

     // 2. Receiver'ın (Şu anki kullanıcı) arkadaş listesine Sender'ı ekle
     const senderAsFriend: Friend = {
          id: sender.id,
          teamName: sender.teamName,
          managerName: sender.managerName,
          avatar: sender.avatar,
          addedAt: new Date().toISOString()
     };
     await setDoc(doc(db, `users/${receiver.id}/friends/${sender.id}`), senderAsFriend);

     // 3. Sender'ın arkadaş listesine Receiver'ı ekle
     const receiverAsFriend: Friend = {
          id: receiver.id,
          teamName: receiver.teamName,
          managerName: receiver.username || receiver.teamName,
          avatar: receiver.username,
          addedAt: new Date().toISOString()
     };
     await setDoc(doc(db, `users/${sender.id}/friends/${receiver.id}`), receiverAsFriend);

     // Temizlik: İsteği silebiliriz veya 'accepted' olarak arşivde tutabiliriz. 
     // Şimdilik tutuyoruz ama sorgularda 'pending' aradığımız için sorun çıkmaz.
     // İleride temizlik job'ı siler.
     await deleteDoc(requestRef); // Veya direkt silelim temiz olsun
};

// İsteği Reddet
export const rejectFriendRequest = async (requestId: string) => {
     await deleteDoc(doc(db, 'friend_requests', requestId));
};

// İki kullanıcı arasındaki durumu kontrol et
export type FriendStatus = 'none' | 'friend' | 'request_sent' | 'request_received';

export const checkFriendStatus = async (currentUserId: string, targetUserId: string): Promise<FriendStatus> => {
     // 1. Arkadaş mı?
     const friendDoc = await getDoc(doc(db, `users/${currentUserId}/friends/${targetUserId}`));
     if (friendDoc.exists()) return 'friend';

     // 2. İstek var mı?
     const requestsRef = collection(db, 'friend_requests');
     // Ben gönderdim mi?
     const qSent = query(
          requestsRef,
          where('senderId', '==', currentUserId),
          where('receiverId', '==', targetUserId),
          where('status', '==', 'pending')
     );
     const sentSnapshot = await getDocs(qSent);
     if (!sentSnapshot.empty) return 'request_sent';

     // O gönderdi mi?
     const qReceived = query(
          requestsRef,
          where('senderId', '==', targetUserId),
          where('receiverId', '==', currentUserId),
          where('status', '==', 'pending')
     );
     const receivedSnapshot = await getDocs(qReceived);
     if (!receivedSnapshot.empty) return 'request_received';

     return 'none';
};

// Kullanıcı Arama (Mevcut)
export const searchUsers = async (searchTerm: string, currentUserId: string): Promise<User[]> => {
     const teamsRef = collection(db, 'teams');
     const termOriginal = searchTerm;
     const termUpper = searchTerm.toUpperCase();

     const queries = [];

     // 1. Orijinal terim ile Takım Adı araması
     queries.push(query(
          teamsRef,
          where('name', '>=', termOriginal),
          where('name', '<=', termOriginal + '\uf8ff'),
          limit(5)
     ));

     // 2. Büyük harf ile Takım Adı araması
     if (termOriginal !== termUpper) {
          queries.push(query(
               teamsRef,
               where('name', '>=', termUpper),
               where('name', '<=', termUpper + '\uf8ff'),
               limit(5)
          ));
     }

     // 3. Orijinal terim ile Menajer Adı araması
     queries.push(query(
          teamsRef,
          where('manager', '>=', termOriginal),
          where('manager', '<=', termOriginal + '\uf8ff'),
          limit(5)
     ));

     // 4. Büyük harf ile Menajer Adı araması
     if (termOriginal !== termUpper) {
          queries.push(query(
               teamsRef,
               where('manager', '>=', termUpper),
               where('manager', '<=', termUpper + '\uf8ff'),
               limit(5)
          ));
     }

     const snapshots = await Promise.all(queries.map(q => getDocs(q)));

     const usersMap = new Map<string, User>();

     snapshots.forEach(snapshot => {
          snapshot.docs.forEach(doc => {
               // Kullanıcının kendisini de sonuçlarda görmek istediği için filtreyi kaldırdık.
               // if (doc.id === currentUserId) return;

               const teamData = doc.data() as ClubTeam; // ClubTeam olarak cast ediyoruz
               const user: User = {
                    id: doc.id,
                    teamName: teamData.name || 'Bilinmeyen Takim',
                    username: teamData.manager || 'Menajer',
                    email: '',
                    teamLogo: teamData.logo || null,
                    connectedAccounts: { google: false, apple: false },
                    contactPhone: null,
                    contactCrypto: null
               };
               usersMap.set(doc.id, user);
          });
     });

     return Array.from(usersMap.values());
};
