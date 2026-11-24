// OpenAPI 3.0 description of THIS APP'S Wasfaty API (not NUPCO's - NUPCO publishes no public
// contract). Served at GET /api/wasfaty/openapi.json so an integrator, a test harness or the
// onboarding team can see exactly what the app expects and returns.
//
// Keep this file honest: if an endpoint changes, change the spec. It is also the document to attach
// when asking NUPCO which of these operations their live contract will supply, and which fields
// their payloads already match.

export const wasfatyOpenApi = {
  openapi: '3.0.3',
  info: {
    title: 'Pharmacy-App Wasfaty / NUPCO API',
    version: '1.0.0',
    description:
      'Provider-neutral dispensing and claim API used by the pharmacy POS. The active adapter ' +
      '(manual, mock, direct, hub) is chosen server-side; the browser always sees this contract. ' +
      'Money model Option A: covered lines are invoiced at the NUPCO-approved value, settled 100% ' +
      'by a wasfaty tender, patient share 0.00.',
  },
  servers: [{ url: '/api/wasfaty' }],
  tags: [
    { name: 'Health', description: 'Adapter and contract status' },
    { name: 'Prescriptions', description: 'Lookup and authorization' },
    { name: 'Dispenses', description: 'Operational dispense records' },
    { name: 'Claims', description: 'Claim ledger and reconciliation' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Active provider, capabilities and contract completeness',
        responses: {
          200: { description: 'Health report', content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } } },
        },
      },
    },
    '/openapi.json': {
      get: { tags: ['Health'], summary: 'This document', responses: { 200: { description: 'OpenAPI document' } } },
    },
    '/prescriptions/lookup': {
      post: {
        tags: ['Prescriptions'],
        summary: 'Fetch a Wasfaty prescription from the active provider',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PrescriptionLookupInput' } } },
        },
        responses: {
          200: { description: 'Prescription', content: { 'application/json': { schema: { $ref: '#/components/schemas/Prescription' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          503: { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/authorizations': {
      post: {
        tags: ['Prescriptions'],
        summary: 'Request (or re-request) NUPCO authorization for the covered lines',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthorizationInput' } } },
        },
        responses: {
          200: { description: 'Authorization result', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthorizationResult' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          503: { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/dispenses': {
      post: {
        tags: ['Dispenses'],
        summary: 'Record a dispense and open its claim',
        description:
          'Idempotent on saleId: replaying the same sale returns the same dispense and claim instead of ' +
          'creating a duplicate. Rejects inconsistent claim arithmetic (sum of lines, claim <= invoice).',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ManualDispenseInput' } } },
        },
        responses: {
          201: {
            description: 'Created (or the existing record for a replayed saleId)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DispenseResult' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          502: { $ref: '#/components/responses/UpstreamError' },
          503: { $ref: '#/components/responses/Unavailable' },
        },
      },
      get: {
        tags: ['Dispenses'],
        summary: 'List dispenses',
        parameters: [
          { name: 'month', in: 'query', schema: { type: 'string', example: '2026-11' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'invoiceNo', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Dispenses, newest first',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    dispenses: { type: 'array', items: { $ref: '#/components/schemas/DispenseRecord' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/dispenses/{id}': {
      get: {
        tags: ['Dispenses'],
        summary: 'Read one dispense and its claim',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Dispense', content: { 'application/json': { schema: { $ref: '#/components/schemas/DispenseResult' } } } },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/dispenses/{id}/cancel': {
      post: {
        tags: ['Dispenses'],
        summary: 'Cancel a dispense and its pending claim',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
            },
          },
        },
        responses: {
          200: { description: 'Cancelled dispense', content: { 'application/json': { schema: { $ref: '#/components/schemas/DispenseResult' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          404: { $ref: '#/components/responses/NotFound' },
          503: { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/claims': {
      get: {
        tags: ['Claims'],
        summary: 'List the claim ledger',
        parameters: [
          { name: 'month', in: 'query', schema: { type: 'string', example: '2026-11' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Claims, newest first',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    claims: { type: 'array', items: { $ref: '#/components/schemas/Claim' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/claims/{id}/submit': {
      post: {
        tags: ['Claims'],
        summary: 'Submit a pending claim through the active provider',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Claim after submission', content: { 'application/json': { schema: { $ref: '#/components/schemas/ClaimResult' } } } },
          404: { $ref: '#/components/responses/NotFound' },
          503: { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
    '/claims/{id}/reconcile': {
      post: {
        tags: ['Claims'],
        summary: 'Record the payer’s answer or a manual month-close reconciliation',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reportedAmount: { type: 'number' },
                  paidAmount: { type: 'number' },
                  varianceReason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Reconciled claim', content: { 'application/json': { schema: { $ref: '#/components/schemas/ClaimResult' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          404: { $ref: '#/components/responses/NotFound' },
          503: { $ref: '#/components/responses/Unavailable' },
        },
      },
    },
  },
  components: {
    responses: {
      BadRequest: {
        description: 'Invalid request',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'Not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Unavailable: {
        description: 'The active provider cannot perform this operation (manual mode, or a live contract not yet supplied)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      UpstreamError: {
        description: 'NUPCO unreachable or returned an error; the local sale is unaffected',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string' },
          code: { type: 'string', example: 'invalid_request' },
        },
      },
      Health: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          provider: { type: 'string', enum: ['manual', 'mock', 'direct', 'hub'] },
          configured: { type: 'boolean' },
          environment: { type: 'string' },
          capabilities: {
            type: 'object',
            properties: {
              lookupPrescription: { type: 'boolean' },
              requestAuthorization: { type: 'boolean' },
              submitDispense: { type: 'boolean' },
              submitClaim: { type: 'boolean' },
            },
          },
          contract: {
            type: 'object',
            properties: {
              source: { type: 'string', enum: ['none', 'file', 'env'] },
              path: { type: 'string' },
              version: { type: 'string' },
              baseUrl: { type: 'string' },
              environment: { type: 'string' },
              missingOperations: { type: 'array', items: { type: 'string' } },
            },
          },
          checkedAt: { type: 'string', format: 'date-time' },
        },
      },
      Session: {
        type: 'object',
        required: ['patientNationalId', 'prescriptionNo', 'prescriberName', 'prescriptionDate'],
        properties: {
          patientNationalId: { type: 'string', pattern: '^\\d{10}$' },
          prescriptionNo: { type: 'string' },
          wasfatyReferenceNo: { type: 'string' },
          authorizationNo: { type: 'string' },
          prescriberName: { type: 'string' },
          prescriberId: { type: 'string' },
          prescriptionDate: { type: 'string', format: 'date' },
          pharmacistId: { type: 'string' },
        },
      },
      DispenseLineInput: {
        type: 'object',
        required: ['lineId', 'nupcoCode', 'itemId', 'itemNameEn', 'qty', 'nupcoUnitPrice', 'patientShare', 'claimAmount'],
        properties: {
          lineId: { type: 'string' },
          nupcoCode: { type: 'string', pattern: '^\\d{13}$' },
          itemId: { type: 'string' },
          itemNameEn: { type: 'string' },
          itemNameAr: { type: 'string' },
          batchNo: { type: 'string' },
          expiryDate: { type: 'string', format: 'date' },
          qty: { type: 'number', exclusiveMinimum: 0 },
          unit: { type: 'string' },
          nupcoUnitPrice: { type: 'number', minimum: 0 },
          patientShare: { type: 'number', minimum: 0, description: '0.00 for a covered line (Option A)' },
          claimAmount: { type: 'number', minimum: 0, description: 'VAT-inclusive line total' },
        },
      },
      ManualDispenseInput: {
        type: 'object',
        required: ['saleId', 'invoiceNo', 'session', 'lines', 'invoiceTotalInclVat', 'claimTotal', 'currency'],
        properties: {
          saleId: { type: 'string', description: 'Idempotency key: the local sale id' },
          invoiceNo: { type: 'string' },
          session: { $ref: '#/components/schemas/Session' },
          lines: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/DispenseLineInput' } },
          invoiceTotalInclVat: { type: 'number', minimum: 0 },
          claimTotal: { type: 'number', minimum: 0, description: 'Must equal the sum of line claimAmount (±0.01)' },
          currency: { type: 'string', example: 'SAR' },
        },
      },
      DispenseRecord: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'WDSP-000001' },
          provider: { type: 'string', enum: ['manual', 'mock', 'direct', 'hub'] },
          status: {
            type: 'string',
            enum: [
              'manual_recorded', 'authorization_pending', 'authorized', 'partially_authorized',
              'rejected', 'dispensed', 'cancelled', 'claim_pending', 'claimed', 'reconciled',
            ],
          },
          saleId: { type: 'string' },
          invoiceNo: { type: 'string' },
          prescriptionNo: { type: 'string' },
          wasfatyReferenceNo: { type: 'string' },
          authorizationNo: { type: 'string' },
          nupcoPrescriptionId: { type: 'string' },
          nupcoDispenseId: { type: 'string' },
          patientIdLast4: { type: 'string' },
          pharmacistId: { type: 'string' },
          dispensedAt: { type: 'string', format: 'date-time' },
          claimId: { type: 'string' },
          claimStatus: { type: 'string' },
          claimMonth: { type: 'string' },
          totalClaimAmount: { type: 'number' },
          totalPatientShare: { type: 'number' },
          lines: { type: 'array', items: { $ref: '#/components/schemas/DispenseLineInput' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Claim: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'WCLM-000001' },
          dispenseId: { type: 'string' },
          invoiceNo: { type: 'string' },
          prescriptionNo: { type: 'string' },
          month: { type: 'string', example: '2026-11' },
          expectedAmount: { type: 'number' },
          reportedAmount: { type: 'number' },
          paidAmount: { type: 'number' },
          status: {
            type: 'string',
            enum: ['pending', 'submitted', 'reported', 'paid', 'variance', 'reconciled', 'cancelled'],
          },
          varianceReason: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      DispenseResult: {
        type: 'object',
        properties: {
          dispense: { $ref: '#/components/schemas/DispenseRecord' },
          claim: { $ref: '#/components/schemas/Claim' },
        },
      },
      ClaimResult: { type: 'object', properties: { claim: { $ref: '#/components/schemas/Claim' } } },
      PrescriptionLookupInput: {
        type: 'object',
        required: ['prescriptionNo'],
        properties: {
          prescriptionNo: { type: 'string' },
          patientNationalId: { type: 'string', pattern: '^\\d{10}$' },
        },
      },
      Prescription: {
        type: 'object',
        properties: {
          prescriptionId: { type: 'string' },
          prescriptionNo: { type: 'string' },
          patientIdLast4: { type: 'string' },
          prescriber: { type: 'object', properties: { name: { type: 'string' }, id: { type: 'string' } } },
          issuedAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['active', 'dispensed', 'expired', 'cancelled'] },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lineId: { type: 'string' },
                nupcoCode: { type: 'string' },
                nameEn: { type: 'string' },
                nameAr: { type: 'string' },
                qty: { type: 'number' },
                unit: { type: 'string' },
                dose: { type: 'string' },
                substitutionAllowed: { type: 'boolean' },
              },
            },
          },
          source: { type: 'string', enum: ['manual', 'mock', 'direct', 'hub'] },
        },
      },
      AuthorizationInput: {
        type: 'object',
        required: ['prescriptionNo', 'patientNationalId', 'lines'],
        properties: {
          prescriptionNo: { type: 'string' },
          patientNationalId: { type: 'string', pattern: '^\\d{10}$' },
          lines: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/DispenseLineInput' } },
        },
      },
      AuthorizationResult: {
        type: 'object',
        properties: {
          authorizationNo: { type: 'string' },
          status: { type: 'string', enum: ['authorized', 'partially_authorized', 'rejected', 'authorization_pending'] },
          approvedLines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lineId: { type: 'string' },
                nupcoCode: { type: 'string' },
                approvedQty: { type: 'number' },
              },
            },
          },
          rejectedLines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lineId: { type: 'string' },
                nupcoCode: { type: 'string' },
                reason: { type: 'string' },
              },
            },
          },
          authorizationId: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  },
} as const;
