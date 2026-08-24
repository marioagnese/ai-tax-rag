export type CrosscheckProviderId =
  | "openai"
  | "openrouter"
  | "gemini"
  | "anthropic";

export type ProviderStatus = "ok" | "error" | "timeout";

export type CrosscheckInput = {
  question: string;
  jurisdiction?: string;
  facts?: string;
  constraints?: string;
  maxTokens?: number;
  timeoutMs?: number;
  runIntent?: "preliminary" | "followup" | "refine" | "finalize";
  responseLanguage?: string;
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

export type ResolutionStatus =
  | "verified"
  | "supported"
  | "fact_dependent"
  | "unresolved"
  | "rejected";

export type IssueProviderPosition = {
  provider: string;
  model: string;
  position: string;
  confidence?: "low" | "medium" | "high";
};

export type IssueAuthorityCitation = {
  cite: string;
  score: number;
  country?: string | null;
  jurisdiction?: string | null;
  law_code?: string | null;
  article?: string | null;
  section?: string | null;
  source_type?: string | null;
  citation_label?: string | null;
  source_url?: string | null;
  page_start?: number | null;
  page_end?: number | null;
};

export type IssueAuthorityValidation = {
  verdict:
    | "verified"
    | "contradicted"
    | "fact_dependent"
    | "insufficient";
  reasoning: string;
  citations: IssueAuthorityCitation[];
};

export type IssueResolution = {
  issue_id: string;
  issue_label: string;
  issue_statement: string;
  provider_positions: IssueProviderPosition[];
  status: ResolutionStatus;
  resolved_position?: string;
  reasoning: string;
  controlling: boolean;
  missing_facts: string[];
  disagreements: string[];
  rejected_positions: string[];
  confidence: "low" | "medium" | "high";
  authority_validation?: IssueAuthorityValidation;
  external_research?: {
    attempted: boolean;
    verdict:
      | "supports_one"
      | "fact_dependent"
      | "unresolved";
    selected_position?: string;
    reasoning: string;
    confidence:
      | "low"
      | "medium"
      | "high";
    source_quality:
      | "primary"
      | "official_secondary"
      | "mixed"
      | "weak";
    sources: Array<{
      title: string;
      url: string;
      publisher?: string;
      source_type?: string;
    }>;
  };

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
    issue_resolutions?: IssueResolution[];
  };
  providers: ProviderOutput[];
};