import app from "@/app";
import {
  envConfig,
  isProduction,
  validateStartupConfig,
} from "@/config/envConfig";
import { ensureStorageDir } from "@/Modules/Storage/objectStorage";
import { createProcessDocumentHandler } from "@/Modules/Documents/Jobs/handlers/process-document.job";
import { initDocumentJobs, recoverPendingDocuments } from "@/Modules/Documents/Jobs/document.jobs";
import { DocumentService } from "@/Modules/Documents/Services/document.services";



// NOTE: server entry — wiring only, no business logic.
// HTTP → validation → auth → controller → service → repository → database.
// Background work fans out through the in-process job queue; see
// `Modules/Documents/Jobs/*`.

// Single shared engine for background document processing.
// WHY one instance: repositories/storage are stateless wrappers around
// the pooled `db` driver, so sharing avoids per-job construction while
// keeping tests free to inject fakes via constructor parameters.
const documentService = new DocumentService();

// WHY a handler factory: queue orchestration (concurrency, recovery)
// stays in `document.jobs.ts`; the per-document workflow binding lives
// in `handlers/process-document.job.ts` and is wired exactly once here.
initDocumentJobs(createProcessDocumentHandler(documentService));



// Fail closed on missing/weak secrets and malformed values before binding.
// In production this throws; in development/test it warns (except PORT and
// JWT_EXPIRES_IN, which always throw because they would crash per request).
validateStartupConfig();

// Prove the object-storage jail exists and is writable before serving
// traffic. Production refuses to boot without it; development warns.
try {
  ensureStorageDir();
} catch (error) {
  if (isProduction) throw error;
  console.warn(
    `[storage] ${error instanceof Error ? error.message : error}; continuing because NODE_ENV=${envConfig.NODE_ENV}.`,
  );
}

app.listen(envConfig.PORT,()=>{
    console.log(`server is listening at port ${envConfig.PORT}`);
    // Requeue anything left PENDING/PROCESSING by a previous shutdown.
    // Recovered jobs use the stored project embedding configuration;
    // failures are isolated per document and never crash boot.
    recoverPendingDocuments().then(
      (count) => {
        if (count > 0) console.log(`requeued ${count} pending documents`);
      },
      (error) => {
        console.error("document recovery failed:", error instanceof Error ? error.message : error);
      },
    );
})

// TODO: add SIGTERM/SIGINT draining (stop accepting jobs, await in-flight
// `processDocument` calls) so deploys never orphan PROCESSING rows.
