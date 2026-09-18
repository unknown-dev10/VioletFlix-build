// services/firebase.ts
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update, remove, get } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCZpP9MtYCAVvXo1Gqg-H_W53R8vyXCgt8",
  authDomain: "violetflix-fd1e1.firebaseapp.com",
  projectId: "violetflix-fd1e1",
  storageBucket: "violetflix-fd1e1.firebasestorage.app",
  messagingSenderId: "934598161485",
  appId: "1:934598161485:web:382e0dc3d243f2f4ff1804",
  measurementId: "G-MGJW1GRJQ2"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

export const watchPartyService = {
  createParty: async (code: string, mediaId: string, hostId: string) => {
    await set(ref(db, `watchparty/${code}`), {
      mediaId,
      hostId,
      currentTime: 0,
      paused: true,
      members: { [hostId]: { joinedAt: Date.now(), isHost: true } },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return code;
  },

  joinParty: async (code: string, userId: string) => {
    const partyRef = ref(db, `watchparty/${code}`);
    const snapshot = await get(partyRef);
    if (!snapshot.exists()) throw new Error('Party not found');
    
    const data = snapshot.val();
    await update(partyRef, {
      [`members/${userId}`]: { joinedAt: Date.now(), isHost: false },
      updatedAt: Date.now(),
    });
    return data;
  },

  syncPlayback: (code: string, time: number, paused: boolean) => {
    update(ref(db, `watchparty/${code}`), {
      currentTime: time,
      paused,
      updatedAt: Date.now(),
    });
  },

  listenToParty: (code: string, callback: (data: any) => void) => {
    return onValue(ref(db, `watchparty/${code}`), (snapshot) => {
      if (snapshot.exists()) callback(snapshot.val());
    });
  },

  leaveParty: async (code: string, userId: string) => {
    const partyRef = ref(db, `watchparty/${code}`);
    const snapshot = await get(partyRef);
    if (!snapshot.exists()) return;
    
    const data = snapshot.val();
    await update(partyRef, {
      [`members/${userId}`]: null,
      updatedAt: Date.now(),
    });
    
    const remainingMembers = Object.keys(data.members || {}).filter(id => id !== userId);
    if (remainingMembers.length === 0) {
      await remove(partyRef);
    }
  },
};
