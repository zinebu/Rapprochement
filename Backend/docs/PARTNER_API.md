# API d'intégration Jupiter → CONSULT-IT Rapprochement

Ce document décrit comment un système externe (par ex. **Jupiter**) peut
déposer automatiquement des **factures** (PDF / image) et des **fichiers
SEPA** (XML) dans la plateforme CONSULT-IT. Les documents sont ingérés,
classifiés par l'agent IA puis rangés automatiquement dans le bon module :

- **Factures** pour les factures d'achat et de vente (PDF, image)
- **Banque / SEPA** pour les relevés bancaires (PDF) et les lots SEPA (XML)

---

## 1. URL de base

| Environnement | Base URL |
|---|---|
| Production   | `https://rapp.consult-it.com/api/partner` |
| Dev / local  | `http://localhost:8000/api/partner`       |

Tous les endpoints sont préfixés par `/api/partner`.

---

## 2. Authentification

Chaque appel doit être authentifié par une **clé d'API** fournie par
CONSULT-IT. Elle peut être transmise de deux façons :

```
X-API-Key: <votre_clef>
```

ou :

```
Authorization: Bearer <votre_clef>
```

- La clé doit être gardée **secrète** (jamais dans le front-end / repo Git).
- Rotation sur demande auprès de CONSULT-IT.
- Une même clé peut être utilisée pour tous les dépôts Jupiter.

Réponses d'erreur d'authentification :

| Code | Signification |
|------|---|
| 401  | Clé manquante |
| 403  | Clé invalide / révoquée |
| 503  | API partenaire non configurée côté serveur |

---

## 3. Endpoint de test (`/health`)

```
GET /api/partner/health
```

Ne nécessite pas de clé. Réponse :

```json
{
  "success": true,
  "service": "partner-ingest",
  "status": "ok",
  "timestamp": "2026-04-22T10:30:00.000Z"
}
```

---

## 4. Déposer un document (facture ou SEPA)

```
POST /api/partner/documents
Content-Type: multipart/form-data
X-API-Key: <votre_clef>
```

### Champs `multipart/form-data`

| Champ        | Type     | Obligatoire | Description |
|--------------|----------|-------------|-------------|
| `file`       | fichier  | **oui**     | Le document à ingérer (PDF, PNG, JPEG, WebP, CSV, XML). Taille max **20 Mo**. |
| `externalId` | texte    | non         | Identifiant côté Jupiter (retourné tel quel). Pratique pour la réconciliation. |
| `note`       | texte    | non         | Note libre associée au dépôt. |

### Types de fichiers acceptés

| Type             | Extensions / MIME                                   | Destination auto |
|------------------|-----------------------------------------------------|------------------|
| Facture (PDF)    | `.pdf`, `application/pdf`                           | **Factures**     |
| Facture (image)  | `.png`, `.jpg`, `.jpeg`, `.webp`                    | **Factures**     |
| Relevé bancaire  | `.pdf` (nom contient « relevé », « statement »…)   | **Banque**       |
| SEPA             | `.xml`, `application/xml`, `text/xml`               | **Banque / SEPA**|
| CSV bancaire     | `.csv`, `text/csv`                                  | **Banque**       |

### Classification automatique

Le serveur exécute en séquence :

1. Extraction du contenu (OCR si besoin).
2. Agent de classification (IA) + parseurs locaux spécialisés.
3. Routage automatique vers `factures`, `banque` ou `a_valider` (si
   ambigu — dans ce cas, le document apparaît dans la file de validation
   manuelle de l'application et l'utilisateur le confirme en un clic).

### Exemple de requête (cURL)

```bash
curl -X POST "https://rapp.consult-it.com/api/partner/documents" \
  -H "X-API-Key: jupiter_live_xxx" \
  -F "file=@/chemin/vers/facture_fournisseur.pdf" \
  -F "externalId=JUP-2026-00042" \
  -F "note=Facture fournisseur XYZ avril 2026"
```

### Exemple (Node.js — `axios` + `form-data`)

```js
import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const form = new FormData();
form.append("file", fs.createReadStream("./facture.pdf"));
form.append("externalId", "JUP-2026-00042");

const res = await axios.post(
  "https://rapp.consult-it.com/api/partner/documents",
  form,
  {
    headers: {
      ...form.getHeaders(),
      "X-API-Key": process.env.CONSULT_IT_API_KEY,
    },
  }
);

console.log(res.data);
```

### Exemple (Python — `requests`)

```python
import requests

with open("sepa_batch.xml", "rb") as f:
    resp = requests.post(
        "https://rapp.consult-it.com/api/partner/documents",
        headers={"X-API-Key": "jupiter_live_xxx"},
        files={"file": ("sepa_batch.xml", f, "application/xml")},
        data={"externalId": "JUP-SEPA-2026-0001"},
    )

print(resp.json())
```

### Réponse (succès — 201 Created)

```json
{
  "success": true,
  "externalId": "JUP-2026-00042",
  "note": "Facture fournisseur XYZ avril 2026",
  "document": {
    "id": "69e78...",
    "fileName": "1776786247224-partner-facture_fournisseur.pdf",
    "originalName": "facture_fournisseur.pdf",
    "mimeType": "application/pdf",
    "status": "sent",
    "destination": "factures",
    "documentType": "invoice",
    "invoiceNature": "purchase",
    "fileUrl": "/uploads/1776786247224-partner-facture_fournisseur.pdf",
    "createdAt": "2026-04-22T10:30:00.000Z"
  },
  "routing": {
    "target": "factures",
    "label": "Module Factures",
    "autoDispatched": true,
    "dispatchError": null
  },
  "classification": {
    "label": "invoice",
    "confidence": 0.95,
    "provider": "openai",
    "invoiceNature": "purchase",
    "fields": {
      "invoiceNumber": "F2026-0042",
      "invoiceDate": "2026-04-10",
      "dueDate": "2026-05-10",
      "amountInclVat": 1200.00,
      "currency": "EUR",
      "issuerName": "FOURNISSEUR XYZ",
      "recipientName": "CONSULT-IT"
    }
  },
  "structuredData": { "...": "détail interne parseur" }
}
```

### Réponses d'erreur

| Code | Cas |
|------|-----|
| 400  | Fichier manquant ou type non supporté |
| 401 / 403 | Clé API manquante ou invalide |
| 500  | Erreur pipeline d'ingestion |

---

## 5. Vérifier le statut d'un document

```
GET /api/partner/documents/:id
X-API-Key: <votre_clef>
```

Utile pour savoir, après coup, si le document a été classé en facture,
relevé bancaire, SEPA ou envoyé dans la file de validation manuelle.

Réponse :

```json
{
  "success": true,
  "document": {
    "id": "69e78...",
    "originalName": "facture_fournisseur.pdf",
    "status": "sent",
    "destination": "factures",
    "documentType": "invoice",
    "invoiceNature": "purchase",
    "createdAt": "2026-04-22T10:30:00.000Z",
    "updatedAt": "2026-04-22T10:30:02.000Z"
  }
}
```

### Valeurs possibles de `destination`

| Valeur       | Description |
|--------------|-------------|
| `factures`   | Rangé automatiquement dans le module **Factures** |
| `banque`     | Rangé dans le module **Banque / SEPA** (relevé ou SEPA XML) |
| `a_valider`  | Ambigu — en attente de validation manuelle côté CONSULT-IT |

### Valeurs possibles de `status`

| Valeur                | Description |
|-----------------------|-------------|
| `sent`                | Document envoyé avec succès dans le module cible |
| `analyzed`            | Analysé, attend un dispatch (cas rare depuis partner API) |
| `manual_review`       | En file de validation manuelle |
| `extraction_failed`   | Impossible d'extraire le contenu du fichier |
| `classification_failed` | Impossible de classifier (sera examiné) |

---

## 6. Résumé pour le manager

Pour que **Jupiter puisse pousser automatiquement factures et SEPA** dans
l'interface CONSULT-IT :

1. **URL** : `POST https://rapp.consult-it.com/api/partner/documents`
2. **Auth** : header `X-API-Key: <clef>` (à fournir par CONSULT-IT).
3. **Payload** : `multipart/form-data` avec le champ `file` (PDF, image,
   XML, CSV). Optionnellement `externalId` et `note`.
4. **Comportement** : le serveur classe et range automatiquement :
   - facture → module **Factures**
   - SEPA XML ou relevé bancaire → module **Banque / SEPA**
5. **Suivi** : `GET /api/partner/documents/:id` pour vérifier le statut.
6. **Test rapide** : `GET /api/partner/health` (sans clé).

---

## 7. Contact

Pour générer / faire tourner une clé API, ou déclarer un nouveau
partenaire : contacter l'équipe technique CONSULT-IT.
