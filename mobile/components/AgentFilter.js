import React, { useState } from "react";
import { View } from "./Themed";
import { useData } from "../hooks/useData";
import { Select, State, Pager } from "./UI";
export default function AgentFilter({ value, onChange }) {
  const [page, setPage] = useState(1);
  const r = useData(`/users?page=${page}`);
  return (
    <View style={{ gap: 10 }}>
      <State resource={r} />
      <Select
        label="Agent filter"
        value={value}
        onChange={onChange}
        options={[
          { label: "All agents", value: "" },
          ...(r.data?.items || [])
            .filter((u) => u.role === "agent")
            .map((u) => ({ label: u.fullName, value: u._id })),
        ]}
      />
      {!!(r.data?.total > 25) && (
        <Pager page={page} setPage={setPage} data={r.data} />
      )}
    </View>
  );
}
