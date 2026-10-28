/**
 * Passerelle IA — Anthropic Claude, compatible avec le format OpenAI Chat Completions.
 *
 * Le nom geminiFetch est conservé pour ne pas modifier les modules appelants.
 * Server-only : ne jamais importer ce module dans un composant client.
 */

type OpenAIMessage = {
  role?: string;
  content?:
    | string
    | Array<
        | { type: "text"; text?: string }
        | { type: "image_url"; image_url?: { url?: string } }
        | { type: "file"; file?: { filename?: string; file_data?: string } }
      >;
};

type OpenAIChatRequest = {
  model?: string;
  messages?: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: {
    type?: string;
    json_schema?: { schema?: Record<string, unknown> };
  };
};

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

const MAP_MODELES: Record<string, string> = {
  "gemini-3.6-flash": "claude-sonnet-5-5",
  "gemini-2.5-flash": "claude-haiku-5-5",
  "gemini-2.0-flash": "claude-haiku-5-5",
  "gemini-1.5-flash": "claude-haiku-5-5",
  "gemini-1.5-pro": "claude-sonnet-5-5",
};

const MODELE_DEFAUT = "claude-sonnet-5-5";

function resoudreModele(nomRecu: string): string {
  if (!nomRecu) return MODELE_DEFAUT;
  const nettoye = nomRecu.replace(/^google\//, "").replace(/^gemini\//, "");
  return MAP_MODELES[nettoye] ?? nettoye;
}

function dataPart(dataUrl: string): AnthropicContentBlock {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,([\s\S]*)$/i);
  if (!match) {
    throw new Error("Anthropic attend un fichier encodé en data URL base64.");
  }
  const mediaType = match[1] || "application/octet-stream";
  const data = match[2] ?? "";

  if (mediaType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data },
    };
  }
  if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) {
    throw new Error("Format de fichier non pris en charge par Anthropic : " + mediaType);
  }
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data },
  };
}

function convertirContenu(content: OpenAIMessage["content"]): AnthropicContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];

  return content.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text ?? "" };
    }
    if (part.type === "image_url") {
      const url = part.image_url?.url;
      if (!url) throw new Error("Image Anthropic sans URL.");
      if (!url.startsWith("data:")) {
        throw new Error("Anthropic attend une image encodée en data URL base64.");
      }
      return dataPart(url);
    }
    if (part.type === "file") {
      const url = part.file?.file_data;
      if (!url) throw new Error("Fichier Anthropic sans contenu.");
      return dataPart(url);
    }
    throw new Error("Format de contenu multimodal non pris en charge par Anthropic.");
  });
}

/** Le retour reste au format Chat Completions utilisé par les modules du CRM. */
export async function geminiFetch(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let request: OpenAIChatRequest;
  try {
    request = JSON.parse(String(init?.body ?? "{}")) as OpenAIChatRequest;
  } catch {
    return Response.json(
      { error: { message: "Corps de requête IA JSON invalide." } },
      { status: 400 },
    );
  }

  const cle = process.env["ANTHROPIC_API_KEY"];
  const workspaceId = process.env["ANTHROPIC_WORKSPACE_ID"];
  if (!cle) {
    return Response.json({ error: { message: "ANTHROPIC_API_KEY est absente." } }, { status: 500 });
  }
  if (!request.model || !request.messages?.length) {
    return Response.json(
      { error: { message: "Modèle ou messages Anthropic manquants." } },
      { status: 400 },
    );
  }

  const messagesSysteme = request.messages.filter(
    (message) => message.role === "system" || message.role === "developer",
  );
  const messagesConversation = request.messages.filter(
    (message) => message.role !== "system" && message.role !== "developer",
  );

  const systemPrompt = messagesSysteme
    .flatMap((message) => convertirContenu(message.content))
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n\n");

  const messages: Array<{ role: "user" | "assistant"; content: AnthropicContentBlock[] }> = [];
  for (const message of messagesConversation) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = convertirContenu(message.content);
    if (!content.length) continue;

    const previous = messages[messages.length - 1];
    if (previous?.role === role) previous.content.push(...content);
    else messages.push({ role, content });
  }

  if (!messages.length || messages[0]?.role !== "user") {
    return Response.json(
      { error: { message: "Aucun message utilisateur fourni à Anthropic." } },
      { status: 400 },
    );
  }

  const body: Record<string, unknown> = {
    model: resoudreModele(request.model),
    messages,
    max_tokens: typeof request.max_tokens === "number" ? request.max_tokens : 4096,
  };
  if (systemPrompt) body["system"] = systemPrompt;
  if (typeof request.temperature === "number") body["temperature"] = request.temperature;

  if (
    request.response_format?.type === "json_object" ||
    request.response_format?.type === "json_schema"
  ) {
    const instructionJson =
      "Réponds strictement avec un JSON valide, sans texte autour, sans markdown et sans bloc de code.";
    body["system"] = systemPrompt ? systemPrompt + "\n\n" + instructionJson : instructionJson;
  }

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cle,
        "anthropic-version": "2023-06-01",
        ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
      },
      body: JSON.stringify(body),
      signal: init?.signal,
    });
  } catch (error) {
    console.error("[passerelle IA] erreur réseau Anthropic", error);
    return Response.json(
      { error: { message: "Impossible de joindre le service Anthropic." } },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[passerelle IA] erreur Anthropic", response.status, detail.slice(0, 500));
    return Response.json(
      { error: { message: "Anthropic a refusé la requête.", status: response.status } },
      { status: response.status },
    );
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  const contenu = (payload.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");

  return Response.json({
    choices: [{ message: { role: "assistant", content: contenu } }],
    model: payload.model ?? body["model"],
    usage: {
      prompt_tokens: payload.usage?.input_tokens ?? 0,
      completion_tokens: payload.usage?.output_tokens ?? 0,
    },
  });
}
