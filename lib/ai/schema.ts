// JSON Schema for Gemini responseSchema (not Zod — Gemini needs plain JSON Schema)
export const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    documentType: {
      type: "string",
      enum: ["tax_return_1040", "w2", "bank_statement", "pay_stub", "closing_disclosure", "underwriting_summary", "title_report", "evoe", "schedule_c", "other", "unknown"],
    },

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
    primaryBorrowerSalary: { type: "number", nullable: true },

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
    coBorrowerSalary: { type: "number", nullable: true },

    // Income records
    incomeRecords: {
      type: "array",
      nullable: true,
      items: {
        type: "object",
        properties: {
          borrowerName: { type: "string", nullable: true },
          year: { type: "number", nullable: true },
          source: {
            type: "string",
            enum: ["w2_wages", "self_employment", "rental", "other"],
            nullable: true,
          },
          amount: { type: "number", nullable: true },
          description: { type: "string", nullable: true },
          pageNumber: { type: "number", nullable: true },
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
          balance: { type: "number", nullable: true },
          balanceDate: { type: "string", nullable: true },
          pageNumber: { type: "number", nullable: true },
        },
        required: [],
      },
    },

    // Loan fields
    loanNumber: { type: "string", nullable: true },
    loanAmount: { type: "number", nullable: true },
    interestRate: { type: "number", nullable: true },
    loanTerm: { type: "number", nullable: true },
    loanType: { type: "string", nullable: true },
    loanPurpose: { type: "string", nullable: true },
    propertyAddress: { type: "string", nullable: true },
    salePrice: { type: "number", nullable: true },
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
          pageNumber: { type: "number", nullable: true },
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
