import { useEffect, useState } from "react";

const STORAGE_KEY = "admin_show_technical_ids";

export function useTechnicalIds() {
  const [showTechnicalIds, setShowTechnicalIds] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(showTechnicalIds));
  }, [showTechnicalIds]);

  return { showTechnicalIds, setShowTechnicalIds };
}
