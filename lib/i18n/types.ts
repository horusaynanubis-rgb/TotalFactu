export type Locale = 'en' | 'es';

export interface Translations {
  // Common
  common: {
    loading: string;
    save: string;
    saving: string;
    cancel: string;
    delete: string;
    edit: string;
    search: string;
    filter: string;
    all: string;
    download: string;
    upload: string;
    approve: string;
    actions: string;
    status: string;
    type: string;
    date: string;
    email: string;
    password: string;
    name: string;
    signIn: string;
    signOut: string;
    signUp: string;
    getStarted: string;
    month: string;
    perMonth: string;
    current: string;
    upgrade: string;
    currentPlan: string;
    yes: string;
    no: string;
    noResults: string;
    copyright: string;
  };

  // Landing page
  landing: {
    heroTitle1: string;
    heroTitle2: string;
    heroDescription: string;
    heroBadge: string;
    startFreeTrial: string;
    viewPricing: string;
    // How it works
    howItWorksTitle: string;
    howItWorksSubtitle: string;
    step1Title: string;
    step1Description: string;
    step2Title: string;
    step2Description: string;
    step3Title: string;
    step3Description: string;
    step4Title: string;
    step4Description: string;
    // Why TotalFactu
    whyTitle: string;
    whySubtitle: string;
    feature1Title: string;
    feature1Description: string;
    feature2Title: string;
    feature2Description: string;
    feature3Title: string;
    feature3Description: string;
    feature4Title: string;
    feature4Description: string;
    feature5Title: string;
    feature5Description: string;
    feature6Title: string;
    feature6Description: string;
    // Also available
    alsoAvailableTitle: string;
    alsoAvailableDescription: string;
    webUpload: string;
    webUploadDesc: string;
    emailForwarding: string;
    emailForwardingDesc: string;
    // Pricing
    pricingTitle: string;
    pricingSubtitle: string;
    mostPopular: string;
    ctaTitle: string;
    ctaSubtitle: string;
    allRightsReserved: string;
    // Gestoria popup
    gestoriaPopupTitle: string;
    gestoriaPopupSubtitle: string;
    gestoriaPackBasic: string;
    gestoriaPackPro: string;
    gestoriaPackBusiness: string;
    gestoriaPackLicenses: string;
    gestoriaPackPerLicense: string;
    gestoriaPackPayNow: string;
    gestoriaContactQuestion: string;
    gestoriaContactPlaceholder: string;
    gestoriaContactName: string;
    gestoriaContactEmail: string;
    gestoriaContactCompany: string;
    // Demo plan
    demoPlanLabel: string;
    demoUpgradeBannerTitle: string;
    demoUpgradeBannerDesc: string;
    demoUpgradeBannerButton: string;
    demoInvoiceLimit: string;
    demoInvoiceLimitDesc: string;
    demoInvoiceLimitButton: string;
    // Support
    supportTitle: string;
    supportDescription: string;
  };

  // Auth
  auth: {
    welcomeBack: string;
    signInToAccount: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    signingIn: string;
    invalidCredentials: string;
    loginSuccess: string;
    loginError: string;
    noAccount: string;
    hasAccount: string;
    createAccount: string;
    createAccountSubtitle: string;
    fullName: string;
    fullNamePlaceholder: string;
    companyName: string;
    companyNamePlaceholder: string;
    taxIdLabel: string;
    taxIdPlaceholder: string;
    confirmPassword: string;
    creatingAccount: string;
    passwordsMismatch: string;
    accountCreated: string;
    signupFailed: string;
    signInManually: string;
    signupError: string;
  };

  // Navigation
  nav: {
    dashboard: string;
    documents: string;
    invoices: string;
    exports: string;
    settings: string;
    billing: string;
    support: string;
    supportHelp: string;
  };

  // Dashboard
  dashboard: {
    title: string;
    welcomeBack: string;
    invoicesThisMonth: string;
    documentsUploaded: string;
    pendingReview: string;
    needsAttention: string;
    totalVatMonth: string;
    taxDetected: string;
    exportsGenerated: string;
    csvReports: string;
    quickActions: string;
    uploadInvoice: string;
    reviewPending: string;
    generateExport: string;
    recentUploads: string;
    noRecentDocuments: string;
    noCompanyFound: string;
  };

  // Documents
  documents: {
    title: string;
    subtitle: string;
    uploadInvoice: string;
    dragAndDrop: string;
    supported: string;
    uploading: string;
    uploadSuccess: string;
    uploadFailed: string;
    fileTooLarge: string;
    fetchFailed: string;
    statusFilter: string;
    channelFilter: string;
    uploadedDocuments: string;
    filename: string;
    uploadDate: string;
    channel: string;
    confidence: string;
    noDocuments: string;
    statusProcessing: string;
    statusCompleted: string;
    statusNeedsReview: string;
    statusFailed: string;
    retryProcessing: string;
    retrying: string;
    retrySuccess: string;
    retryFailed: string;
    deleteDocument: string;
    deleteConfirmTitle: string;
    deleteConfirmMessage: string;
    deleteSuccess: string;
    deleteFailed: string;
    deleting: string;
    previewDocument: string;
    previewLoading: string;
    previewError: string;
    previewOpenTab: string;
    previewClose: string;
    previewUnsupported: string;
  };

  // Invoices
  invoices: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    typeFilter: string;
    reviewFilter: string;
    received: string;
    issued: string;
    pending: string;
    approved: string;
    rejected: string;
    invoiceList: string;
    invoiceNumber: string;
    supplier: string;
    customer: string;
    amount: string;
    review: string;
    noInvoices: string;
    approveSuccess: string;
    approveFailed: string;
    fetchFailed: string;
    // Edit/review fields
    editInvoice: string;
    saveChanges: string;
    savingChanges: string;
    editSuccess: string;
    editFailed: string;
    invoiceType: string;
    issueDate: string;
    dueDate: string;
    supplierTaxId: string;
    customerTaxId: string;
    subtotal: string;
    taxAmount: string;
    totalAmount: string;
    currency: string;
    taxRate: string;
    paymentMethod: string;
    category: string;
    notes: string;
    confidence: string;
    reviewStatus: string;
    reject: string;
    deleteInvoice: string;
    deleteConfirmTitle: string;
    deleteConfirmMessage: string;
    alsoDeleteDocument: string;
    deleteSuccess: string;
    deleteFailed: string;
    deleting: string;
    duplicateWarning: string;
    previewOriginal: string;
    previewNoDocument: string;
  };

  // Exports
  exports: {
    title: string;
    subtitle: string;
    monthlyExport: string;
    monthlyDescription: string;
    generateMonthlyCSV: string;
    quarterlyExport: string;
    quarterlyDescription: string;
    generateQuarterlyCSV: string;
    exportHistory: string;
    exportDate: string;
    period: string;
    records: string;
    emailStatus: string;
    noExports: string;
    generateSuccess: string;
    generateFailed: string;
    downloadStarted: string;
    downloadFailed: string;
    fetchFailed: string;
  };

  // Settings
  settings: {
    title: string;
    subtitle: string;
    companyProfile: string;
    companyInfo: string;
    companyNameLabel: string;
    taxIdLabel: string;
    addressLabel: string;
    exportEmailSettings: string;
    exportEmailDescription: string;
    exportRecipientEmail: string;
    exportEmailHelp: string;
    integrationSettings: string;
    connectServices: string;
    telegramBot: string;
    webhookUrl: string;
    configureWebhook: string;
    connected: string;
    notConfigured: string;
    emailForwarding: string;
    forwardInvoicesHelp: string;
    emailForwardingPlaceholder: string;
    saveSettings: string;
    saveSuccess: string;
    saveFailed: string;
    fetchFailed: string;
    // Telegram settings
    telegramTitle: string;
    telegramSubtitle: string;
    telegramOfficialBot: string;
    telegramOpenBot: string;
    telegramLinked: string;
    telegramNotLinked: string;
    telegramLinkedAs: string;
    telegramLinkInstruction: string;
    telegramCodeInstruction: string;
    telegramCodeExpires: string;
    telegramGenerateCode: string;
    telegramGeneratingCode: string;
    telegramCodeGenerated: string;
    telegramCodeFailed: string;
    telegramUnlink: string;
    telegramUnlinked: string;
    telegramUnlinkFailed: string;
    // AI Provider settings
    aiProviderTitle: string;
    aiProviderSubtitle: string;
    aiProviderLabel: string;
    aiProviderAbacus: string;
    aiProviderExternal: string;
    aiApiKeyLabel: string;
    aiApiKeyPlaceholder: string;
    aiApiEndpointLabel: string;
    aiApiEndpointPlaceholder: string;
    aiProviderHelp: string;
  };

  // Billing
  billing: {
    title: string;
    subtitle: string;
    currentPlanTitle: string;
    planFeatures: string;
    availablePlans: string;
    stripeNotice: string;
    stripeKeysRequired: string;
    fetchFailed: string;
  };

  // Review queue
  review: {
    title: string;
    subtitle: string;
    pendingInvoices: string;
    pendingDocuments: string;
    totalPending: string;
    invoicesSection: string;
    documentsSection: string;
    noInvoicesPending: string;
    noDocumentsPending: string;
    editAndApprove: string;
    viewDocument: string;
    approveSuccess: string;
    rejectSuccess: string;
    editApproveSuccess: string;
    actionFailed: string;
    fetchFailed: string;
    saving: string;
    reasonsTitle: string;
    reasonLowConfidence: string;
    reasonMissingNumber: string;
    reasonMissingSupplier: string;
    reasonMissingCustomer: string;
    reasonMissingAmount: string;
    reasonTypeUncertain: string;
    confidence: string;
  };

  // Status badges (legacy — internal/technical labels)
  statusBadges: {
    processing: string;
    completed: string;
    needsReview: string;
    failed: string;
    pending: string;
    approved: string;
    rejected: string;
  };

  // Unified functional status — same labels used across Documents, Invoices, Review, Gestoria
  unifiedStatus: {
    processing: string;
    error: string;
    pending: string;
    reviewed: string;
    rejected: string;
    waiting: string;
    done: string;
  };

  // Subscription plan features
  planFeatures: {
    demo: string[];
    profesional: string[];
    gestoria: string[];
    beta: string[];
  };
}
