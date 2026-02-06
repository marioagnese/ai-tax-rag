export type CrosscheckProviderId = "openai" | "openrouter" | "gemini";

export type ProviderStatus = "ok" | "error" | "timeout";

export type CrosscheckInput = {
  question: string;
  jurisdiction?: string;
  facts?: string;
  constraints?: string;
  maxTokens?: number;
  timeoutMs?: number;
};

export type ProviderCall = {
  provider: CrosscheckProviderId;
  model: string;
};

export type ProviderOutput = {
  provider: CrosscheckProviderId;
  model: string;
  status: ProviderStatus;
  ms: number;
  text?: string;
  error?: string;
  usage?: any;
};

export type CrosscheckResult = {
  ok: boolean;
  meta: {
    attempted: ProviderCall[];
    succeeded: ProviderCall[];
    failed: ProviderCall[];
    runtime_ms: number;
  };
  consensus: {
    answer: string;
    caveats: string[];
    followups: string[];
    confidence: "low" | "medium" | "high";
    disagreements: string[];
  };
  providers: ProviderOutput[];
};
