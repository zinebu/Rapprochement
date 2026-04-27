import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./imports";

type SepaOperation = {
  id: string;
  creditorName: string;
  creditorIban: string;
  creditorBic?: string | null;
  amount: number;
  currency: string;
  endToEndId: string;
  remittanceInfo: string;
};

type SepaBatch = {
  id: string;
  sourceDocumentId?: string;
  label?: string;
  executionDate?: string | null;
  totalAmount?: number;
  numberOfTransactions?: number;
  debtorName?: string | null;
  debtorIban?: string | null;
  debtorCurrency?: string | null;
  operations: SepaOperation[];
};

type ImportedDoc = {
  _id?: string;
  documentType?: string;
  structuredData?: {
    documentType?: string;
    sepaBatch?: SepaBatch;
  };
};

function normalizeRef(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/[\s\-_./]+/g, "");
}

export default function SepaPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [batches, setBatches] = useState<SepaBatch[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    const load = async () => {
      const importsRes = await fetch("/api/imports", { credentials: "include" });
      const importsData = await importsRes.json().catch(() => ({}));
      if (!importsRes.ok) return;

      const docs: ImportedDoc[] = Array.isArray(importsData?.documents) ? importsData.documents : [];
      const importedBatches = docs
        .map((d) => {
          const batch = d?.structuredData?.sepaBatch;
          if (!batch || !batch.id) return null;
          const seenIds = new Set<string>();
          const normalizedOperations = (batch.operations || []).map((op, index) => {
            const baseId = String(op?.id || op?.endToEndId || `sepa-op-${index + 1}`);
            let uniqueId = baseId;
            if (seenIds.has(uniqueId)) uniqueId = `${baseId}-${index + 1}`;
            seenIds.add(uniqueId);
            return { ...op, id: uniqueId };
          });
          return {
            ...batch,
            operations: normalizedOperations,
            sourceDocumentId: d._id,
          } as SepaBatch;
        })
        .filter((b): b is SepaBatch => Boolean(b && b.id));
      setBatches(importedBatches);

      const ref = params.get("ref");
      if (ref) {
        const wanted = normalizeRef(ref);
        const match = importedBatches.find((b) => normalizeRef(b.id) === wanted);
        if (match) setSelectedId(match.id);
      } else if (importedBatches[0]) {
        setSelectedId(importedBatches[0].id);
      }
    };
    void load();
  }, [params]);

  const selected = useMemo(
    () => batches.find((b) => b.id === selectedId) || null,
    [batches, selectedId]
  );

  const selectedTotal = useMemo(() => {
    if (!selected) return null;
    if (typeof selected.totalAmount === "number" && !Number.isNaN(selected.totalAmount)) {
      return selected.totalAmount;
    }
    return selected.operations.reduce((sum, op) => sum + Number(op.amount || 0), 0);
  }, [selected]);

  const deleteSepaBatch = async (batch: SepaBatch) => {
    if (!batch.sourceDocumentId) return;
    const res = await fetch(`/api/imports/${encodeURIComponent(batch.sourceDocumentId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok && res.status !== 404) return;
    setBatches((prev) => prev.filter((b) => b.id !== batch.id));
    if (selectedId === batch.id) {
      const next = batches.find((b) => b.id !== batch.id);
      setSelectedId(next?.id || "");
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">SEPA</h1>
          <p className="text-sm text-muted-foreground">Lots SEPA importés depuis le module Import.</p>
        </div>
        <Button variant="outline" onClick={() => navigate("/banque")}>Retour Banque</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lots SEPA importés</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun lot SEPA importé.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {batches.map((batch) => (
                <div key={batch.id} className="inline-flex items-center gap-1">
                  <Button
                    variant={selectedId === batch.id ? "default" : "outline"}
                    onClick={() => setSelectedId(batch.id)}
                  >
                    {batch.id}
                  </Button>
                  {batch.sourceDocumentId ? (
                    <Button variant="outline" size="sm" onClick={() => void deleteSepaBatch(batch)}>
                      Supprimer
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{selected.label || selected.id}</CardTitle>
              {selected.sourceDocumentId ? (
                <Button variant="outline" size="sm" onClick={() => void deleteSepaBatch(selected)}>
                  Supprimer cette SEPA
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div><span className="text-muted-foreground">Référence :</span> {selected.id}</div>
              <div><span className="text-muted-foreground">Date exécution :</span> {selected.executionDate || "—"}</div>
              <div><span className="text-muted-foreground">Débiteur :</span> {selected.debtorName || "—"}</div>
              <div><span className="text-muted-foreground">Nb opérations :</span> {selected.numberOfTransactions ?? selected.operations.length}</div>
              <div><span className="text-muted-foreground">Total :</span> {selectedTotal != null ? `${selectedTotal.toFixed(2)} ${selected.debtorCurrency || "EUR"}` : "—"}</div>
            </div>
            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Créancier</TableHead>
                    <TableHead>IBAN</TableHead>
                    <TableHead>Réf</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.operations.map((op) => (
                    <TableRow key={op.id}>
                      <TableCell>{op.creditorName}</TableCell>
                      <TableCell>{op.creditorIban}</TableCell>
                      <TableCell>{op.endToEndId}</TableCell>
                      <TableCell className="text-right">{op.amount} {op.currency}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
