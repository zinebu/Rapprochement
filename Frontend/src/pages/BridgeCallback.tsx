import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function BridgeCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const success = searchParams.get("success");
    const itemId = searchParams.get("item_id");

    console.log("Bridge callback success =", success);
    console.log("Bridge callback item_id =", itemId);

    if (success === "true" && itemId) {
      navigate(`/banque?connected=1&item_id=${encodeURIComponent(itemId)}`, {
        replace: true,
      });
      return;
    }

    navigate("/banque?bridge_error=1", { replace: true });
  }, [navigate, searchParams]);

  return <div>Connexion bancaire terminée...</div>;
}