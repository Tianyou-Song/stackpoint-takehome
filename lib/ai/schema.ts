// JSON Schema for structured output (OpenRouter response_format)
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    documentType: {
      type: "string",
      enum: ["tax_return_1040", "w2", "bank_statement", "pay_stub", "closing_disclosure", "underwriting_summary", "title_report", "evoe", "schedule_c", "other", "unknown"],
    },
    pageCount: { type: "integer", nullable: true },
    documentTitle: { type: "string", nullable: true },
    documentYears: { type: "array", nullable: true, items: { type: "integer" } },

    // Primary borrower
    primaryBorrowerName: { type: "string", nullable: true },
    primaryBorrowerSSN: { type: "string", nullable: true },
    primaryBorrowerDOB: { type: "string", nullable: true },
    primaryBorrowerPhone: { type: "string", nullable: true },
    primaryBorrowerEmail: { type: "string", nullable: true },
    primaryBorrowerAddress: { type: "string", nullable: true },
    primaryBorrowerEmployer: { type: "string", nullable: true },
    primaryBorrowerJobTitle: { type: "string", nullable: true },
    primaryBorrowerHireDate: { type: "string", nullable: true },
    primaryBorrowerSalary: { type: "string", nullable: true, description: "Annual salary as a number string, e.g. \"75000\" or \"75000.50\"" },

    // Co-borrower
    coBorrowerName: { type: "string", nullable: true },
    coBorrowerSSN: { type: "string", nullable: true },
    coBorrowerDOB: { type: "string", nullable: true },
    coBorrowerPhone: { type: "string", nullable: true },
    coBorrowerEmail: { type: "string", nullable: true },
    coBorrowerAddress: { type: "string", nullable: true },
    coBorrowerEmployer: { type: "string", nullable: true },
    coBorrowerJobTitle: { type: "string", nullable: true },
    coBorrowerHireDate: { type: "string", nullable: true },
    coBorrowerSalary: { type: "string", nullable: true, description: "Annual salary as a number string" },

    // Income records
    incomeRecords: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        properties: {
          borrowerName: { type: "string", nullable: true },
          year: { type: "integer", nullable: true },
          source: {
            type: "string",
            enum: ["base_salary", "overtime", "commission", "bonus", "self_employment", "rental", "other_income"],
            nullable: true,
          },
          kind: {
            type: "string",
            enum: ["component", "doc_total", "underwriting_total"],
            nullable: true,
          },
          period: {
            type: "string",
            enum: ["annual", "ytd", "monthly"],
            nullable: true,
          },
          periodEndDate: { type: "string", nullable: true },
          isJoint: { type: "boolean", nullable: true },
          amount: { type: "string", nullable: true, description: "Dollar amount as a number string, e.g. \"50000\" or \"50000.50\"" },
          description: { type: "string", nullable: true },
          pageNumber: { type: "integer", nullable: true },
          exactQuote: { type: "string", nullable: true },
        },
        required: [],
      },
    },

    // Accounts
    accounts: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        properties: {
          borrowerName: { type: "string", nullable: true },
          institution: { type: "string", nullable: true },
          accountType: {
            type: "string",
            enum: ["checking", "savings", "investment", "other"],
            nullable: true,
          },
          accountNumberMasked: { type: "string", nullable: true },
          balance: { type: "string", nullable: true, description: "Balance as a number string, e.g. \"25000\" or \"25000.50\"" },
          balanceDate: { type: "string", nullable: true },
          pageNumber: { type: "integer", nullable: true },
        },
        required: [],
      },
    },

    // Loan fields
    loanNumber: { type: "string", nullable: true },
    loanAmount: { type: "string", nullable: true, description: "Loan amount as a number string, e.g. \"280000\"" },
    interestRate: { type: "string", nullable: true, description: "Interest rate as a number string, e.g. \"4.00\"" },
    loanTerm: { type: "integer", nullable: true },
    loanType: { type: "string", nullable: true },
    loanPurpose: { type: "string", nullable: true },
    propertyAddress: { type: "string", nullable: true },
    salePrice: { type: "string", nullable: true, description: "Sale price as a number string, e.g. \"350000\"" },
    closingDate: { type: "string", nullable: true },
    lenderName: { type: "string", nullable: true },

    // Extracted fields with provenance
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fieldName: { type: "string" },
          fieldValue: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          pageNumber: { type: "integer", nullable: true },
          exactQuote: { type: "string", nullable: true },
          category: {
            type: "string",
            enum: ["borrower", "loan", "income", "account", "property", "other"],
          },
        },
        required: ["fieldName", "fieldValue", "confidence", "category"],
      },
    },
  },
  required: ["documentType", "fields"],
};

export function getResponseFormat() {
  return {
    type: "json_schema" as const,
    json_schema: {
      name: "document_extraction",
      strict: false,
      schema: EXTRACTION_SCHEMA,
    },
  };
}
