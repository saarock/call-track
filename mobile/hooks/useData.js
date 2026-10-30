import { useState, useCallback, useRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
export function useData(path) {
  const { revision } = useAuth();
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    setLoading(true);
    try {
      const response = await api.get(path);
      if (ticket === sequence.current) {
        setData(response.data);
        setError("");
      }
    } catch (e) {
      if (ticket === sequence.current) setError(e.message);
    } finally {
      if (ticket === sequence.current) setLoading(false);
    }
  }, [path]);
  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {
        sequence.current++;
      };
    }, [refresh, revision]),
  );
  return { data, error, loading, refresh };
}
