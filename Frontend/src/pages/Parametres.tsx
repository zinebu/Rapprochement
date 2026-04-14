import {
  useState,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  toast,
  Building2,
  Save,
  SlidersHorizontal,
} from "./imports";

export default function Parametres() {
  const [company, setCompany] = useState({
    name: "Ma Société SAS",
    country: "FR",
    currency: "EUR",
    vatFrequency: "mensuel",
    startDate: "2024-01-01",
  });

  const [matching, setMatching] = useState({
    amountTolerance: "0.50",
    dateWindow: "15",
  });

  const handleSave = () => {
    toast.success("Paramètres enregistrés (données locales, connectez Lovable Cloud pour persister).");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Paramètres</h1>
        <p className="text-muted-foreground">Configuration de votre société et règles de traitement</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Informations société
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Raison sociale</Label>
            <Input value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Pays</Label>
              <Select value={company.country} onValueChange={v => setCompany({ ...company, country: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FR">France</SelectItem>
                  <SelectItem value="BE">Belgique</SelectItem>
                  <SelectItem value="CH">Suisse</SelectItem>
                  <SelectItem value="LU">Luxembourg</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Devise</Label>
              <Select value={company.currency} onValueChange={v => setCompany({ ...company, currency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="CHF">CHF (CHF)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Régime TVA</Label>
              <Select value={company.vatFrequency} onValueChange={v => setCompany({ ...company, vatFrequency: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensuel">Mensuel</SelectItem>
                  <SelectItem value="trimestriel">Trimestriel</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Date de début d'activité</Label>
              <Input type="date" value={company.startDate} onChange={e => setCompany({ ...company, startDate: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Règles de rapprochement
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Tolérance montant (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={matching.amountTolerance}
                onChange={e => setMatching({ ...matching, amountTolerance: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">Écart max accepté (ex: frais bancaires)</p>
            </div>
            <div className="grid gap-2">
              <Label>Fenêtre de dates (jours)</Label>
              <Input
                type="number"
                value={matching.dateWindow}
                onChange={e => setMatching({ ...matching, dateWindow: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">±jours autour de la date facture</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave}>
        <Save className="h-4 w-4 mr-1.5" />
        Enregistrer les paramètres
      </Button>
    </div>
  );
}
