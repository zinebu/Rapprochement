import { BRIDGE_BASE_URL, bridgeHeaders } from "../config/bridge.js";
import { bridgeSessionStore } from "../storage/bridgeSessionStore.js";

export async function createConnectSession(req, res) {
  try {
    const { userId, email, callbackUrl } = req.body;

    if (!userId || !email) {
      return res.status(400).json({
        error: "userId et email sont requis",
      });
    }

    bridgeSessionStore.externalUserId = userId;

    const createUserRes = await fetch(`${BRIDGE_BASE_URL}/users`, {
      method: "POST",
      headers: bridgeHeaders(),
      body: JSON.stringify({
        external_user_id: userId,
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
      : { external_user_id: userId };

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
      user_email: email,
    };

    if (callbackUrl) {
      connectBody.callback_url = callbackUrl;
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