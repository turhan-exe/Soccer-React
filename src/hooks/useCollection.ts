import { useEffect, useState } from 'react';
import { collection, onSnapshot, QuerySnapshot, DocumentData } from 'firebase/firestore';
import { db } from '@/services/firebase';

type CollectionMapper<T> = (snapshot: QuerySnapshot<DocumentData>) => T[];

export interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
}

const pathToSegments = (path: string): string[] => path.split('/').filter(Boolean);

export function useCollection<T = DocumentData>(path: string, mapper?: CollectionMapper<T>): UseCollectionResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const segments = pathToSegments(path);
    if (segments.length === 0) {
      setError(new Error('Koleksiyon yolu gecersiz.'));
      setLoading(false);
      return;
    }
    setLoading(true);
    const colRef = collection(db, ...segments);
    const unsubscribe = onSnapshot(
      colRef,
      (snapshot) => {
        try {
          const mapped = mapper ? mapper(snapshot) : (snapshot.docs.map((docSnap) => docSnap.data() as T));
          setData(mapped);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [path, mapper]);

  return { data, loading, error };
}

export default useCollection;
