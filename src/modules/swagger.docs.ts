/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Authentication and authorization endpoints
 *   - name: Chatbot
 *     description: AI-powered negotiation chatbot
 *   - name: Bid Comparison
 *     description: Multi-vendor bid comparison and selection
 *   - name: Vector
 *     description: Vector search and RAG operations
 *   - name: Requisition
 *     description: Purchase requisition management
 *   - name: Contract
 *     description: Contract management
 *   - name: Vendor
 *     description: Vendor operations
 *   - name: Company
 *     description: Company management
 *   - name: User
 *     description: User management
 *   - name: Health
 *     description: Service health monitoring
 */

// ==================== DASHBOARD ====================

/**
 * @swagger
 * /api/dashboard/stats:
 *   get:
 *     summary: Get dashboard analytics and statistics
 *     description: |
 *       Returns comprehensive dashboard data for the authenticated user's company.
 *       All sections are filtered by the selected time period.
 *
 *       **Sections included:**
 *       - **KPIs** — Total savings, active negotiations, total requisitions, avg deal improvement (with delta vs previous period)
 *       - **Negotiation Pipeline** — Count of deals by status (Negotiating, Accepted, Walked Away, Escalated)
 *       - **Savings Over Time** — Per-bucket savings (bars), cumulative running total (line), and previous period overlay
 *       - **Spend by Category** — Requisition spend grouped by category
 *       - **Recent Activity** — Latest deal status changes and requisition creations
 *       - **Needs Attention** — Stalled negotiations, approaching deadlines, escalated deals, unresponsive vendors
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 1y, all]
 *           default: 30d
 *         description: Time period filter. Controls date range for all dashboard sections.
 *     responses:
 *       200:
 *         description: Dashboard statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/DashboardStatsData'
 *       401:
 *         description: Unauthorized — missing or invalid JWT
 *       404:
 *         description: User company not found
 */

/**
 * @swagger
 * /api/dashboard/get:
 *   get:
 *     summary: Get legacy dashboard data
 *     description: |
 *       Returns legacy dashboard data including budget totals, category summaries,
 *       time-wise requisition counts, and RFQ price comparisons.
 *       **Note:** Prefer `/api/dashboard/stats` for the redesigned dashboard.
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: dayYear
 *         schema:
 *           type: string
 *           example: "30"
 *         description: Time range filter (number of days, or 1 for 1 year, 5 for 5 years)
 *     responses:
 *       200:
 *         description: Legacy dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Dashboard Data
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalBudget:
 *                       type: number
 *                       example: 500000
 *                     actualPrice:
 *                       type: number
 *                       example: 425000
 *                     totalSaving:
 *                       type: number
 *                       example: 75000
 *                     getCategoryWiseRequisitionTotalPrice:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           category:
 *                             type: string
 *                           total_price:
 *                             type: number
 *                           actual_price:
 *                             type: number
 *                     statusWiseReqCount:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           status:
 *                             type: string
 *                           requisition_count:
 *                             type: integer
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User company not found
 */

// ==================== PRODUCT ====================

/**
 * @swagger
 * /api/product/create:
 *   post:
 *     summary: Create a new product
 *     tags: [Product]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productName
 *               - category
 *               - brandName
 *               - gstType
 *               - tds
 *               - type
 *               - UOM
 *             properties:
 *               productName:
 *                 type: string
 *                 example: Laptop Stand
 *               category:
 *                 type: string
 *                 example: IT/Electronics
 *               brandName:
 *                 type: string
 *                 example: ErgoTech
 *               gstType:
 *                 type: string
 *                 enum: [GST, Non-GST]
 *                 example: GST
 *               gstPercentage:
 *                 type: number
 *                 enum: [0, 5, 12, 18, 28]
 *                 description: Required when gstType is GST
 *                 example: 18
 *               tds:
 *                 type: number
 *                 description: HSN Code
 *                 example: 84713010
 *               type:
 *                 type: string
 *                 enum: [Goods, Services]
 *                 example: Goods
 *               UOM:
 *                 type: string
 *                 enum: [units, kgs, liters, boxes, packs, tons, meters, lots, license]
 *                 example: units
 *     responses:
 *       201:
 *         description: Product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Product created successfully
 *                 data:
 *                   type: object
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/product/get-all:
 *   get:
 *     summary: List products with pagination and search
 *     tags: [Product]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by product name
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Paginated list of products
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Products
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 totalCount:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/product/getall:
 *   get:
 *     summary: List all products (no pagination)
 *     tags: [Product]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All products for the user's company
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Products
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/product/get/{productid}:
 *   get:
 *     summary: Get product by ID
 *     tags: [Product]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productid
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Product
 *                 data:
 *                   type: object
 *       404:
 *         description: Product not found
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/product/update/{productid}:
 *   put:
 *     summary: Update a product
 *     tags: [Product]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productid
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               productName:
 *                 type: string
 *               category:
 *                 type: string
 *               brandName:
 *                 type: string
 *               gstType:
 *                 type: string
 *                 enum: [GST, Non-GST]
 *               gstPercentage:
 *                 type: number
 *                 enum: [0, 5, 12, 18, 28]
 *               tds:
 *                 type: number
 *               type:
 *                 type: string
 *                 enum: [Goods, Services]
 *               UOM:
 *                 type: string
 *                 enum: [units, kgs, liters, boxes, packs, tons, meters, lots, license]
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/product/delete/{productid}:
 *   delete:
 *     summary: Delete a product
 *     tags: [Product]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productid
 *         required: true
 *         schema:
 *           type: integer
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *       401:
 *         description: Unauthorized
 */

// ==================== AUTH ====================

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - name
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 8
 *               name:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already exists
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                 refreshToken:
 *                   type: string
 *                 user:
 *                   type: object
 *       401:
 *         description: Invalid credentials
 */

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed
 *       401:
 *         description: Invalid refresh token
 */

/**
 * @swagger
 * /api/auth/validate-token:
 *   post:
 *     summary: Validate access token (service-to-service)
 *     description: |
 *       Validates a JWT access token and returns the user context. Intended for use by other
 *       backend services that need to verify tokens issued by this auth API (login/signup).
 *
 *       **Token can be provided via:**
 *       - `Authorization: Bearer <token>` header
 *       - `{ "token": "<token>" }` in request body
 *
 *       **Optional:** When `AUTH_SERVICE_SECRET` is set, requires `X-Service-Secret` header to match.
 *     tags: [Auth]
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         schema:
 *           type: string
 *           example: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *         description: Bearer token to validate
 *       - in: header
 *         name: X-Service-Secret
 *         schema:
 *           type: string
 *         description: Required when AUTH_SERVICE_SECRET env is set; shared secret for backend services
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: Alternative to Authorization header
 *     responses:
 *       200:
 *         description: Token valid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Token valid
 *                 data:
 *                   type: object
 *                   properties:
 *                     valid:
 *                       type: boolean
 *                       example: true
 *                     context:
 *                       type: object
 *                       properties:
 *                         userId:
 *                           type: integer
 *                           example: 1
 *                         userType:
 *                           type: string
 *                           example: customer
 *                         companyId:
 *                           type: integer
 *                           example: 5
 *                         email:
 *                           type: string
 *                           example: user@example.com
 *       400:
 *         description: Token is required
 *       401:
 *         description: Invalid token, expired, or service authentication required
 */

// ==================== CHATBOT ====================

/**
 * @swagger
 * /api/chatbot/deals:
 *   post:
 *     summary: Create a new negotiation deal
 *     tags: [Chatbot]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               requisitionId:
 *                 type: integer
 *               vendorId:
 *                 type: integer
 *               mode:
 *                 type: string
 *                 enum: [INSIGHTS, CONVERSATION]
 *                 default: INSIGHTS
 *     responses:
 *       201:
 *         description: Deal created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Deal'
 *       401:
 *         description: Unauthorized
 *   get:
 *     summary: List all deals
 *     tags: [Chatbot]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [NEGOTIATING, ACCEPTED, WALKED_AWAY, ESCALATED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: List of deals
 */

/**
 * @swagger
 * /api/chatbot/deals/{dealId}:
 *   get:
 *     summary: Get deal by ID
 *     tags: [Chatbot]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Deal details with messages
 *       404:
 *         description: Deal not found
 */

/**
 * @swagger
 * /api/chatbot/deals/{dealId}/messages:
 *   post:
 *     summary: Process vendor message (INSIGHTS mode)
 *     tags: [Chatbot]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: Vendor message with offer details
 *                 example: "I can offer $95 per unit with Net 30 payment terms"
 *     responses:
 *       200:
 *         description: Message processed with AI decision
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deal:
 *                   $ref: '#/components/schemas/Deal'
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *                 decision:
 *                   type: object
 *                   properties:
 *                     action:
 *                       type: string
 *                       enum: [ACCEPT, COUNTER, WALK_AWAY, ESCALATE, ASK_CLARIFY]
 *                     utilityScore:
 *                       type: number
 *                     counterOffer:
 *                       type: object
 */

/**
 * @swagger
 * /api/chatbot/deals/{dealId}/suggest-counters:
 *   post:
 *     summary: Generate AI-powered counter-offer suggestions
 *     tags: [Chatbot]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Counter-offer suggestions by scenario
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 HARD:
 *                   type: array
 *                   items:
 *                     type: string
 *                 MEDIUM:
 *                   type: array
 *                   items:
 *                     type: string
 *                 SOFT:
 *                   type: array
 *                   items:
 *                     type: string
 *                 WALK_AWAY:
 *                   type: array
 *                   items:
 *                     type: string
 */

/**
 * @swagger
 * /api/chatbot/deals/{dealId}/reset:
 *   post:
 *     summary: Reset deal state
 *     tags: [Chatbot]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Deal reset successfully
 */

// ==================== BID COMPARISON ====================

/**
 * @swagger
 * /api/bid-comparison/{requisitionId}:
 *   get:
 *     summary: Get comparison status for requisition
 *     tags: [Bid Comparison]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Comparison status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BidComparison'
 */

/**
 * @swagger
 * /api/bid-comparison/{requisitionId}/bids:
 *   get:
 *     summary: List all vendor bids for requisition
 *     tags: [Bid Comparison]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of vendor bids
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/VendorBid'
 */

/**
 * @swagger
 * /api/bid-comparison/{requisitionId}/generate:
 *   post:
 *     summary: Manually generate comparison report
 *     tags: [Bid Comparison]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Comparison generated
 *       400:
 *         description: No completed bids to compare
 */

/**
 * @swagger
 * /api/bid-comparison/{requisitionId}/pdf:
 *   get:
 *     summary: Download comparison PDF report
 *     tags: [Bid Comparison]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: PDF file
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: No comparison report exists
 */

/**
 * @swagger
 * /api/bid-comparison/{requisitionId}/select/{bidId}:
 *   post:
 *     summary: Select winning vendor
 *     tags: [Bid Comparison]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitionId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Optional reason for selection
 *     responses:
 *       200:
 *         description: Vendor selected, PO created, notifications sent
 *       400:
 *         description: Invalid selection
 *       404:
 *         description: Bid not found
 */

/**
 * @swagger
 * /api/bid-comparison/{requisitionId}/selection:
 *   get:
 *     summary: Get selection details
 *     tags: [Bid Comparison]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requisitionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Selection details with audit trail
 *       404:
 *         description: No selection made yet
 */

// ==================== VECTOR ====================

/**
 * @swagger
 * /api/vector/search/messages:
 *   post:
 *     summary: Search similar negotiation messages
 *     tags: [Vector]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *                 example: "I can offer $95 with Net 30 terms"
 *               topK:
 *                 type: integer
 *                 default: 5
 *               filters:
 *                 type: object
 *                 properties:
 *                   role:
 *                     type: string
 *                     enum: [VENDOR, ACCORDO]
 *                   decisionAction:
 *                     type: string
 *     responses:
 *       200:
 *         description: Similar messages found
 */

/**
 * @swagger
 * /api/vector/rag/{dealId}:
 *   post:
 *     summary: Get RAG context for deal
 *     tags: [Vector]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dealId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *             properties:
 *               query:
 *                 type: string
 *     responses:
 *       200:
 *         description: RAG context for LLM prompt augmentation
 */

/**
 * @swagger
 * /api/vector/health:
 *   get:
 *     summary: Check embedding service health
 *     tags: [Vector]
 *     responses:
 *       200:
 *         description: Embedding service status
 */

// ==================== REQUISITION ====================

/**
 * @swagger
 * /api/requisition:
 *   get:
 *     summary: List requisitions
 *     tags: [Requisition]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of requisitions
 *   post:
 *     summary: Create requisition
 *     tags: [Requisition]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - projectId
 *             properties:
 *               title:
 *                 type: string
 *               projectId:
 *                 type: integer
 *               description:
 *                 type: string
 *               products:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       201:
 *         description: Requisition created
 */

/**
 * @swagger
 * /api/requisition/{id}:
 *   get:
 *     summary: Get requisition by ID
 *     tags: [Requisition]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Requisition details
 *       404:
 *         description: Not found
 *   put:
 *     summary: Update requisition
 *     tags: [Requisition]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     summary: Delete requisition
 *     tags: [Requisition]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Deleted
 */

// ==================== CONTRACT ====================

/**
 * @swagger
 * /api/contract:
 *   get:
 *     summary: List contracts
 *     tags: [Contract]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of contracts
 *   post:
 *     summary: Create contract (attach vendor to requisition)
 *     tags: [Contract]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - requisitionId
 *               - vendorId
 *             properties:
 *               requisitionId:
 *                 type: integer
 *               vendorId:
 *                 type: integer
 *               skipEmail:
 *                 type: boolean
 *                 description: Skip sending notification email
 *               skipChatbot:
 *                 type: boolean
 *                 description: Skip creating chatbot deal
 *     responses:
 *       201:
 *         description: Contract created, vendor notified
 */

// ==================== VENDOR ====================

/**
 * @swagger
 * /api/vendor:
 *   get:
 *     summary: List vendors
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of vendors
 *   post:
 *     summary: Create vendor
 *     tags: [Vendor]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Vendor created
 */

// ==================== COMPANY ====================

/**
 * @swagger
 * /api/company:
 *   get:
 *     summary: List companies
 *     tags: [Company]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of companies
 *   post:
 *     summary: Create company
 *     tags: [Company]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Company created
 */

// ==================== USER ====================

/**
 * @swagger
 * /api/user:
 *   get:
 *     summary: List users
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users
 */

/**
 * @swagger
 * /api/user/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User details
 */

export {};
