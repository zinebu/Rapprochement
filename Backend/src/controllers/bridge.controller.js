import { BRIDGE_BASE_URL, bridgeHeaders } from "../config/bridge.js";
import { bridgeSessionStore } from "../storage/bridgeSessionStore.js";

function isBridgeConfigured() {
  return Boolean(process.env.BRIDGE_CLIENT_ID && process.env.BRIDGE_CLIENT_SECRET);
}

const demoAccounts = [
  {
    id: "demo-acc-1",
    name: "Compte Courant Demo",
    display_name: "Compte Principal Demo",
    iban: "FR76 0000 0000 0000 0000 0000 000",
    balance: 12840.5,
    currency_code: "EUR",
    data_access: "enabled",
  },
];

const demoTransactions = [
  {
    id: "demo-tx-1",
    account_id: "demo-acc-1",
    amount: -11400,
    currency_code: "EUR",
    clean_description: "VIR SEPA FOURN-CIT-010825 - ALTEC CONSULTING",
    date: "2026-04-20",
    category: "Virement sortant",
  },
  {
    id: "demo-tx-2",
    account_id: "demo-acc-1",
    amount: 24300,
    currency_code: "EUR",
    clean_description: "Encaissement client DEMO",
    date: "2026-04-21",
    category: "Virement entrant",
  },
];

export async function createConnectSession(req, res) {
  try {
    const {
      callbackUrl,
      redirect_url: redirectUrl,
      account_types: accountTypesFromBody,
      provider_id: providerIdFromBody,
      item_id: itemIdFromBody,
      country_code: countryCodeFromBody,
    } = req.body || {};

    const resolvedCallbackUrl = callbackUrl || redirectUrl;
    const resolvedAccountTypes =
      accountTypesFromBody === "all" || accountTypesFromBody === "payment"
        ? accountTypesFromBody
        : "payment";

    if (!isBridgeConfigured()) {
      const fallbackUrl = `${req.protocol}://${req.get("host")}/connecteurs`;
      const callback = resolvedCallbackUrl || fallbackUrl;
      bridgeSessionStore.accessToken = "demo-token";
      bridgeSessionStore.externalUserId = "demo-user";
      return res.json({
        demo: true,
        message: "Mode démo Bridge actif (sans credentials).",
        url: callback,
        account_types: resolvedAccountTypes,
        provider_id: providerIdFromBody || null,
        item_id: itemIdFromBody || null,
      });
    }

    const { userId, email } = req.body || {};
    const sessionUser = req.session?.user || {};
    const resolvedUserId =
      userId ||
      sessionUser.id ||
      sessionUser.username ||
      sessionUser.email ||
      `sandbox-user-${Date.now()}`;
    const resolvedEmail =
      email ||
      sessionUser.email ||
      (sessionUser.username?.includes("@") ? sessionUser.username : null) ||
      "sandbox.user@consult-it.local";

    bridgeSessionStore.externalUserId = resolvedUserId;

    const createUserRes = await fetch(`${BRIDGE_BASE_URL}/users`, {
      method: "POST",
      headers: bridgeHeaders(),
      body: JSON.stringify({
        external_user_id: resolvedUserId,
      }),
    });

    const createUserData = await createUserRes.json();
    console.log("createUserData =", createUserData);

    const bridgeUserUuid =
      createUserData?.uuid ||
      createUserData?.id ||
      bridgeSessionStore.userUuid ||
      null;

    const tokenPayload = bridgeUserUuid
      ? { user_uuid: bridgeUserUuid }
      : { external_user_id: resolvedUserId };

    const tokenRes = await fetch(`${BRIDGE_BASE_URL}/authorization/token`, {
      method: "POST",
      headers: bridgeHeaders(),
      body: JSON.stringify(tokenPayload),
    });

    const tokenData = await tokenRes.json();
    console.log("tokenData =", tokenData);

    if (!tokenRes.ok || !tokenData?.access_token) {
      return res.status(tokenRes.status || 500).json({
        error: "Impossible de récupérer le token Bridge",
        details: tokenData,
      });
    }

    bridgeSessionStore.accessToken = tokenData.access_token;

    if (bridgeUserUuid) {
      bridgeSessionStore.userUuid = bridgeUserUuid;
    }

    const connectBody = {
      user_email: resolvedEmail,
      account_types: resolvedAccountTypes,
    };

    if (resolvedCallbackUrl) {
      connectBody.callback_url = resolvedCallbackUrl;
    }
    if (providerIdFromBody) {
      connectBody.provider_id = providerIdFromBody;
    }
    if (itemIdFromBody) {
      connectBody.item_id = itemIdFromBody;
    }
    if (countryCodeFromBody) {
      connectBody.country_code = countryCodeFromBody;
    }

    const connectRes = await fetch(`${BRIDGE_BASE_URL}/connect-sessions`, {
      method: "POST",
      headers: bridgeHeaders({
        Authorization: `Bearer ${tokenData.access_token}`,
      }),
      body: JSON.stringify(connectBody),
    });

    const connectData = await connectRes.json();
    console.log("connectData =", connectData);

    if (!connectRes.ok) {
      return res.status(connectRes.status).json({
        error: "Impossible de créer la connect session",
        details: connectData,
      });
    }

    return res.json(connectData);
  } catch (error) {
    console.error("connect-session error:", error);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(error),
    });
  }
}
export async function getAccounts(req, res) {
  try {
    if (!isBridgeConfigured()) {
      return res.json({
        demo: true,
        resources: demoAccounts,
      });
    }

    if (!bridgeSessionStore.accessToken) {
      return res.status(400).json({
        error: "Aucun access token Bridge en mémoire. Connecte une banque d'abord.",
      });
    }

    const itemId = req.query.item_id;
    const onlyEnabled = req.query.only_enabled === "true";

    const url = new URL(`${BRIDGE_BASE_URL}/accounts`);

    if (itemId) {
      url.searchParams.set("item_id", String(itemId));
    }

    console.log("req.query =", req.query);
    console.log("Bridge accounts URL =", url.toString());

    const accountsRes = await fetch(url.toString(), {
      method: "GET",
      headers: bridgeHeaders({
        Authorization: `Bearer ${bridgeSessionStore.accessToken}`,
      }),
    });

    const accountsData = await accountsRes.json();

    if (!accountsRes.ok) {
      return res.status(accountsRes.status).json(accountsData);
    }

    let resources = Array.isArray(accountsData?.resources)
      ? accountsData.resources
      : [];

    if (onlyEnabled) {
      resources = resources.filter((acc) => acc.data_access === "enabled");
    }

    return res.json({
      ...accountsData,
      resources,
    });
  } catch (error) {
    console.error("accounts error:", error);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(error),
    });
  }
}

export async function getTransactions(req, res) {
  try {
    if (!isBridgeConfigured()) {
      const accountId = req.query.account_id;
      const resources = accountId
        ? demoTransactions.filter((tx) => String(tx.account_id) === String(accountId))
        : demoTransactions;
      return res.json({
        demo: true,
        resources,
      });
    }

    if (!bridgeSessionStore.accessToken) {
      return res.status(400).json({
        error: "Aucun access token Bridge en mémoire. Connecte une banque d'abord.",
      });
    }

    const accountId = req.query.account_id;
    const url = new URL(`${BRIDGE_BASE_URL}/transactions`);

    if (accountId) {
      url.searchParams.set("account_id", String(accountId));
    }

    const txRes = await fetch(url.toString(), {
      method: "GET",
      headers: bridgeHeaders({
        Authorization: `Bearer ${bridgeSessionStore.accessToken}`,
      }),
    });

    const txData = await txRes.json();
    console.log("transactionsData =", txData);

    return res.status(txRes.status).json(txData);
  } catch (error) {
    console.error("transactions error:", error);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(error),
    });
  }
}

export async function getItems(req, res) {
  try {
    if (!isBridgeConfigured()) {
      return res.json({
        demo: true,
        resources: [
          {
            id: "demo-item-1",
            connector_name: "Demo Bank",
            status: "active",
          },
        ],
      });
    }

    if (!bridgeSessionStore.accessToken) {
      return res.status(400).json({
        error: "Aucun access token Bridge en mémoire. Connecte une banque d'abord.",
      });
    }

    const itemsRes = await fetch(`${BRIDGE_BASE_URL}/items`, {
      method: "GET",
      headers: bridgeHeaders({
        Authorization: `Bearer ${bridgeSessionStore.accessToken}`,
      }),
    });

    const itemsData = await itemsRes.json();
    console.log("itemsData =", itemsData);

    return res.status(itemsRes.status).json(itemsData);
  } catch (error) {
    console.error("items error:", error);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(error),
    });
  }
}

export async function getCategories(req, res) {
  try {
    if (!isBridgeConfigured()) {
      return res.json({
        demo: true,
        resources: [
          {
            id: 1,
            name: "Virements",
            categories: [
              { id: 11, name: "Virement entrant" },
              { id: 12, name: "Virement sortant" },
            ],
          },
        ],
      });
    }

    if (!bridgeSessionStore.accessToken) {
      return res.status(400).json({
        error: "Aucun access token Bridge en mémoire. Connecte une banque d'abord.",
      });
    }

    const categoriesRes = await fetch(`${BRIDGE_BASE_URL}/categories`, {
      method: "GET",
      headers: bridgeHeaders({
        Authorization: `Bearer ${bridgeSessionStore.accessToken}`,
        "Accept-Language": "fr",
      }),
    });

    const categoriesData = await categoriesRes.json();
    console.log("categoriesData =", categoriesData);

    return res.status(categoriesRes.status).json(categoriesData);
  } catch (error) {
    console.error("categories error:", error);
    return res.status(500).json({
      error: "Erreur serveur",
      details: String(error),
    });
  }
}