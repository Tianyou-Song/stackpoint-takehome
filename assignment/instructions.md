Overview
Build an unstructured data extraction system using a provided document corpus. You will have full autonomy over the technology stack and implementation approach.

Problem Description
The provided folder contains a corpus of documents with variable formatting, mixed file types, and structured data embedded within unstructured text. The goal is to design and implement a system that extracts meaningful, structured data from these documents.

The solution should include logic for parsing unstructured data as well as an API or interface to serve the processed data in a meaningful form.

You may choose one document set to analyze:

Loan Documents

Analyze the documents and produce a structured record for each borrower that includes extracted PII like their name, address, full income history, and associated account/loan numbers, with a clear reference to the original document(s) from which the information was sourced

Zoning Meeting Minutes

Analyze the documents and create an endpoint that allows a user to query for data that shows actions and votes per board member over time.
Deliverables

1. System Design Document (Markdown or PDF)

Architecture overview, including component diagram

Data pipeline design covering ingestion, processing, storage, and retrieval

AI/LLM integration strategy and model selection rationale

Approach for handling document format variability

Scaling considerations for 10x and 100x document volume

Key technical trade-offs and reasoning

Error handling strategy and data quality validation approach

2. Working Implementation

Document ingestion pipeline

Extraction logic using AI/LLM tooling

Structured output generation (e.g., JSON or database-backed)

Basic query or retrieval interface

Test coverage for critical paths (encouraged but not required)

3. README

Setup and run instructions

Summary of architectural and implementation decisions

Submission Instructions
You should submit your work as a git repository (GitHub, GitLab, or similar) containing all deliverables. A link to the repository should be emailed to me upon completion.