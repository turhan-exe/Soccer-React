import {
     addDoc,
     and,
     collection,
     deleteDoc,
     doc,
     getDoc,
     getDocs,
     limit,
     or,
     query,
     setDoc,
     updateDoc,
     where,
} from 'firebase/firestore';
import { db } from '@/services/firebase';
import type { ClubTeam, Friend, FriendRequest, User } from '@/types';
import { resolveLiveTeamIdentities, resolveLiveTeamIdentity, type LiveTeamIdentity } from './teamIdentity';

const buildFriendRecord = (
     userId: string,
     identity: LiveTeamIdentity | null | undefined,
     fallback: {
          teamName?: string | null;
          managerName?: string | null;
          avatar?: string | null;
          addedAt?: string | null;
     },
): Friend => {
     const resolvedTeamName =
          identity?.teamName || String(fallback.teamName || '').trim() || 'Bilinmeyen Takim';
     const resolvedManagerName =
          identity?.managerName
          || String(fallback.managerName || '').trim()
          || resolvedTeamName
          || 'Menajer';
     const avatarSeed = String(fallback.avatar || '').trim() || resolvedManagerName || resolvedTeamName;

     return {
          id: userId,
          teamName: resolvedTeamName,
          managerName: resolvedManagerName,
          avatar: avatarSeed || undefined,
          addedAt: String(fallback.addedAt || '').trim(),
     };
};

export const getFriends = async (userId: string): Promise<Friend[]> => {
     const friendsRef = collection(db, `users/${userId}/friends`);
     const snapshot = await getDocs(friendsRef);
     const rawFriends = snapshot.docs.map((friendDoc) => {
          const data = friendDoc.data() as Partial<Friend>;
          return {
               id: friendDoc.id,
               teamName: String(data.teamName || '').trim(),
               managerName: String(data.managerName || '').trim(),
               avatar: data.avatar,
               addedAt: String(data.addedAt || '').trim(),
          } as Friend;
     });

     const liveIdentities = await resolveLiveTeamIdentities(rawFriends.map((friend) => friend.id));
     return rawFriends.map((friend) =>
          buildFriendRecord(friend.id, liveIdentities.get(friend.id), friend),
     );
};

export const removeFriend = async (currentUserId: string, friendId: string) => {
     await deleteDoc(doc(db, `users/${currentUserId}/friends/${friendId}`));
     await deleteDoc(doc(db, `users/${friendId}/friends/${currentUserId}`));
};

export const sendFriendRequest = async (currentUser: User, targetUser: User) => {
     const requestsRef = collection(db, 'friend_requests');

     const pendingRequestQuery = query(
          requestsRef,
          or(
               and(
                    where('senderId', '==', currentUser.id),
                    where('receiverId', '==', targetUser.id),
                    where('status', '==', 'pending'),
               ),
               and(
                    where('senderId', '==', targetUser.id),
                    where('receiverId', '==', currentUser.id),
                    where('status', '==', 'pending'),
               ),
          ),
     );

     const existingDocs = await getDocs(pendingRequestQuery);
     if (!existingDocs.empty) {
          throw new Error('Zaten bekleyen bir istek var.');
     }

     const senderIdentity = await resolveLiveTeamIdentity(currentUser.id);
     const senderName =
          senderIdentity?.teamName || String(currentUser.teamName || '').trim() || 'Takimim';
     const senderManager =
          senderIdentity?.managerName || String(currentUser.username || '').trim() || senderName;

     const newRequest: Omit<FriendRequest, 'id'> = {
          senderId: currentUser.id,
          senderName,
          senderManager,
          senderAvatar: senderManager || senderName,
          receiverId: targetUser.id,
          status: 'pending',
          createdAt: new Date().toISOString(),
     };

     await addDoc(requestsRef, newRequest);
};

export const getFriendRequests = async (userId: string): Promise<FriendRequest[]> => {
     const requestsRef = collection(db, 'friend_requests');
     const pendingRequestsQuery = query(
          requestsRef,
          where('receiverId', '==', userId),
          where('status', '==', 'pending'),
     );

     const snapshot = await getDocs(pendingRequestsQuery);
     const requests = snapshot.docs.map((requestDoc) => ({
          id: requestDoc.id,
          ...(requestDoc.data() as Omit<FriendRequest, 'id'>),
     }));
     const liveIdentities = await resolveLiveTeamIdentities(
          requests.map((request) => request.senderId),
     );

     return requests.map((request) => {
          const identity = liveIdentities.get(request.senderId);
          return {
               ...request,
               senderName: identity?.teamName || request.senderName,
               senderManager: identity?.managerName || request.senderManager,
               senderAvatar:
                    String(request.senderAvatar || '').trim()
                    || identity?.managerName
                    || identity?.teamName
                    || request.senderAvatar,
          };
     });
};

export const acceptFriendRequest = async (
     requestId: string,
     sender: { id: string; teamName: string; managerName: string; avatar: string },
     receiver: User,
) => {
     const requestRef = doc(db, 'friend_requests', requestId);
     await updateDoc(requestRef, { status: 'accepted' });

     const liveIdentities = await resolveLiveTeamIdentities([sender.id, receiver.id]);
     const addedAt = new Date().toISOString();

     const senderAsFriend = buildFriendRecord(
          sender.id,
          liveIdentities.get(sender.id),
          {
               teamName: sender.teamName,
               managerName: sender.managerName,
               avatar: sender.avatar,
               addedAt,
          },
     );
     await setDoc(doc(db, `users/${receiver.id}/friends/${sender.id}`), senderAsFriend);

     const receiverAsFriend = buildFriendRecord(
          receiver.id,
          liveIdentities.get(receiver.id),
          {
               teamName: receiver.teamName,
               managerName: receiver.username || receiver.teamName,
               avatar: receiver.username,
               addedAt,
          },
     );
     await setDoc(doc(db, `users/${sender.id}/friends/${receiver.id}`), receiverAsFriend);

     await deleteDoc(requestRef);
};

export const rejectFriendRequest = async (requestId: string) => {
     await deleteDoc(doc(db, 'friend_requests', requestId));
};

export type FriendStatus = 'none' | 'friend' | 'request_sent' | 'request_received';

export const checkFriendStatus = async (
     currentUserId: string,
     targetUserId: string,
): Promise<FriendStatus> => {
     const friendDoc = await getDoc(doc(db, `users/${currentUserId}/friends/${targetUserId}`));
     if (friendDoc.exists()) return 'friend';

     const requestsRef = collection(db, 'friend_requests');
     const sentQuery = query(
          requestsRef,
          where('senderId', '==', currentUserId),
          where('receiverId', '==', targetUserId),
          where('status', '==', 'pending'),
     );
     const sentSnapshot = await getDocs(sentQuery);
     if (!sentSnapshot.empty) return 'request_sent';

     const receivedQuery = query(
          requestsRef,
          where('senderId', '==', targetUserId),
          where('receiverId', '==', currentUserId),
          where('status', '==', 'pending'),
     );
     const receivedSnapshot = await getDocs(receivedQuery);
     if (!receivedSnapshot.empty) return 'request_received';

     return 'none';
};

export const searchUsers = async (searchTerm: string, currentUserId: string): Promise<User[]> => {
     const teamsRef = collection(db, 'teams');
     const termOriginal = searchTerm;
     const termUpper = searchTerm.toUpperCase();

     const queries = [];

     queries.push(query(
          teamsRef,
          where('name', '>=', termOriginal),
          where('name', '<=', termOriginal + '\uf8ff'),
          limit(5),
     ));

     if (termOriginal !== termUpper) {
          queries.push(query(
               teamsRef,
               where('name', '>=', termUpper),
               where('name', '<=', termUpper + '\uf8ff'),
               limit(5),
          ));
     }

     queries.push(query(
          teamsRef,
          where('manager', '>=', termOriginal),
          where('manager', '<=', termOriginal + '\uf8ff'),
          limit(5),
     ));

     if (termOriginal !== termUpper) {
          queries.push(query(
               teamsRef,
               where('manager', '>=', termUpper),
               where('manager', '<=', termUpper + '\uf8ff'),
               limit(5),
          ));
     }

     const snapshots = await Promise.all(queries.map((queryRef) => getDocs(queryRef)));
     const usersMap = new Map<string, User>();

     snapshots.forEach((snapshot) => {
          snapshot.docs.forEach((teamDoc) => {
               const teamData = teamDoc.data() as ClubTeam;
               usersMap.set(teamDoc.id, {
                    id: teamDoc.id,
                    teamName: teamData.name || 'Bilinmeyen Takim',
                    username: teamData.manager || 'Menajer',
                    email: '',
                    teamLogo: teamData.logo || null,
                    connectedAccounts: { google: false, apple: false },
                    contactPhone: null,
                    contactCrypto: null,
               });
          });
     });

     return Array.from(usersMap.values());
};
