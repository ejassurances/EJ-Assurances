/** Adaptateur minimal OpenAI Chat Completions vers l'API Gemini native. */
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

function dataPart(dataUrl: string): { inlineData: { mimeType: string; data: string } } {
  const match = dataUrl.match(/^data:([^;,]+)?;base64,([\s\S]*)$/i);
  if (!match) throw new Error("Gemini attend un fichier encodé en data URL base64.");
  return {
    inlineData: {
      mimeType: match[1] || "application/octet-stream",
      data: match[2]!,
    },
  };
}

function convertirContenu(content: OpenAIMessage["content"]): Record<string, unknown>[] {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];

  return content.map((part) => {
    if (part.type === "text") return { text: part.text ?? "" };
    if (part.type === "image_url") {
      const url = part.image_url?.url;
      if (!url) throw new Error("Image Gemini sans URL.");
      return dataPart(url);
    }
    if (part.type === "file") {
      const url = part.file?.file_data;
      if (!url) throw new Error("Fichier Gemini sans contenu.");
      return dataPart(url);
    }
    throw new Error("Format de contenu multimodal non pris en charge par Gemini.");
  });
}

/** Le retour reste au format Chat Completions utilisé par les modules du CRM. */
export async function geminiFetch(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = JSON.parse(String(init?.body ?? "{}")) as OpenAIChatRequest;
  const headers = new Headers(init?.headers);
  const cle = headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || process.env["GEMINI_API_KEY"];
  if (!cle) {
    return Response.json({ error: { message: "GEMINI_API_KEY est absente." } }, { status: 500 });
  }
  if (!request.model || !request.messages?.length) {
    return Response.json({ error: { message: "Modèle ou messages Gemini manquants." } }, { status: 400 });
  }

  const instructionSysteme = request.messages
    .filter((message) => message.role === "system" || message.role === "developer")
    .flatMap((message) => convertirContenu(message.content));
  const contents = request.messages
    .filter((message) => message.role !== "system" && message.role !== "developer")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: convertirContenu(message.content),
    }));

  const generationConfig: Record<string, unknown> = {};
  if (typeof request.temperature === "number") generationConfig["temperature"] = request.temperature;
  if (typeof request.max_tokens === "number") generationConfig["maxOutputTokens"] = request.max_tokens;
  if (request.response_format?.type === "json_object" || request.response_format?.type === "json_schema") {
    generationConfig["responseMimeType"] = "application/json";
    const schema = request.response_format.json_schema?.schema;
    if (schema) generationConfig["responseJsonSchema"] = schema;
  }

  const model = request.model.replace(/^google\//, "");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cle },
      body: JSON.stringify({
        ...(instructionSysteme.length ? { systemInstruction: { parts: instructionSysteme } } : {}),
        contents,
        ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
      }),
      signal: init?.signal,
    },
  );
  if (!response.ok) return response;

  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const contenu = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  return Response.json({
    choices: [{ message: { role: "assistant", content: contenu } }],
    model,
    usage: {
      prompt_tokens: payload.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
    },
  });
}
