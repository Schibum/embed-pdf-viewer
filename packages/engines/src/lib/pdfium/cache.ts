import { PdfPathSubpathErase } from "@embedpdf/models";
import { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { MemoryManager } from "./core/memory-manager";
import { buildSubpathReplacement, SubpathMovePage } from "./subpath-erase";
import { WasmPointer } from "./types/branded";

export interface CacheConfig {
  /** Time-to-live for pages in milliseconds (default: 5000ms) */
  pageTtl?: number;
  /** Maximum number of pages to keep in cache per document (default: 50) */
  maxPagesPerDocument?: number;
  /**
   * When true, pages are loaded with normalized rotation:
   * - All coordinates (annotations, text, rendering) are in 0° space
   * - The original rotation is preserved for reference
   * @default false
   */
  normalizeRotation?: boolean;
}

const DEFAULT_CONFIG: Required<CacheConfig> = {
  pageTtl: 5000, // 5 seconds
  maxPagesPerDocument: 10,
  normalizeRotation: false,
};

export class PdfCache {
  private readonly docs = new Map<string, DocumentContext>();
  private readonly config: Required<CacheConfig>;

  constructor(
    private readonly pdfium: WrappedPdfiumModule,
    private readonly memoryManager: MemoryManager,
    config: CacheConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Open (or re-use) a document */
  setDocument(id: string, filePtr: number, docPtr: number, normalizeRotation: boolean = false) {
    let ctx = this.docs.get(id);
    if (!ctx) {
      // Use per-document normalizeRotation, overriding global config
      const docConfig = { ...this.config, normalizeRotation };
      ctx = new DocumentContext(filePtr, docPtr, this.pdfium, this.memoryManager, docConfig);
      this.docs.set(id, ctx);
    }
  }

  /** Retrieve the DocumentContext for a given PdfDocumentObject */
  getContext(docId: string): DocumentContext | undefined {
    return this.docs.get(docId);
  }

  /** Close & fully release a document and all its pages */
  closeDocument(docId: string): boolean {
    const ctx = this.docs.get(docId);
    if (!ctx) return false;
    ctx.dispose(); // tears down pages first, then FPDF_CloseDocument, free()
    this.docs.delete(docId);
    return true;
  }

  /** Close all documents */
  closeAllDocuments(): void {
    for (const ctx of this.docs.values()) {
      ctx.dispose();
    }
    this.docs.clear();
  }

  /** Update cache configuration for all existing documents */
  updateConfig(newConfig: CacheConfig): void {
    Object.assign(this.config, newConfig);
    // Update config for all existing document contexts
    for (const ctx of this.docs.values()) {
      ctx.updateConfig(this.config);
    }
  }

  /** Get current cache statistics */
  getCacheStats(): {
    documents: number;
    totalPages: number;
    pagesByDocument: Record<string, number>;
  } {
    const pagesByDocument: Record<string, number> = {};
    let totalPages = 0;

    for (const [docId, ctx] of this.docs.entries()) {
      const pageCount = ctx.getCacheSize();
      pagesByDocument[docId] = pageCount;
      totalPages += pageCount;
    }

    return {
      documents: this.docs.size,
      totalPages,
      pagesByDocument,
    };
  }
}

export class DocumentContext {
  private readonly pageCache: PageCache;
  public readonly normalizeRotation: boolean;

  constructor(
    public readonly filePtr: number,
    public readonly docPtr: number,
    pdfium: WrappedPdfiumModule,
    private readonly memoryManager: MemoryManager,
    config: Required<CacheConfig>,
  ) {
    this.normalizeRotation = config.normalizeRotation;
    this.pageCache = new PageCache(pdfium, docPtr, config, memoryManager);
  }

  /** Main accessor for pages */
  acquirePage(pageIdx: number): PageContext {
    return this.pageCache.acquire(pageIdx);
  }

  /**
   * Soft-delete / restore page objects, persisting the choice so it survives
   * page reloads (e.g. REFRESH_PAGES). Returns true when every id resolved.
   */
  setObjectsActive(pageIdx: number, idPaths: number[][], active: boolean): boolean {
    return this.pageCache.setObjectsActive(pageIdx, idPaths, active);
  }

  /**
   * Set the erased-subpaths state of path objects (line-wise erase),
   * persisting it so it survives page reloads.
   */
  setPathSubpathsInactive(pageIdx: number, items: PdfPathSubpathErase[]): boolean {
    return this.pageCache.setPathSubpathsInactive(pageIdx, items);
  }

  /** Pointers of live subpath-replacement objects on the loaded page. */
  getReplacementPtrs(pageIdx: number): number[] {
    return this.pageCache.getReplacementPtrs(pageIdx);
  }

  /** Set an object's total translation (PDF page space), persisted across reloads. */
  setObjectTranslation(pageIdx: number, idPath: number[], pdx: number, pdy: number): boolean {
    return this.pageCache.setObjectTranslation(pageIdx, idPath, pdx, pdy);
  }

  /** Set the total translation (PDF page space) of subpaths of a path object,
   *  persisted across reloads (line-wise move). */
  setSubpathTranslation(
    pageIdx: number,
    idPath: number[],
    subpaths: number[],
    pdx: number,
    pdy: number,
  ): boolean {
    return this.pageCache.setSubpathTranslation(pageIdx, idPath, subpaths, pdx, pdy);
  }

  /** Acquire/borrow a page handle for one-off geometry conversions. */
  borrowPageContext<T>(pageIdx: number, fn: (ctx: PageContext) => T): T {
    return this.pageCache.borrowPage(pageIdx, fn);
  }

  /** Scoped accessor for one-off / bulk operations */
  borrowPage<T>(pageIdx: number, fn: (ctx: PageContext) => T): T {
    return this.pageCache.borrowPage(pageIdx, fn);
  }

  /** Update cache configuration */
  updateConfig(config: Required<CacheConfig>): void {
    this.pageCache.updateConfig(config);
  }

  /** Get number of pages currently in cache */
  getCacheSize(): number {
    return this.pageCache.size();
  }

  /** Tear down all pages + this document */
  dispose(): void {
    // 1️⃣ release all pages (with their TTL or immediate)
    this.pageCache.forceReleaseAll();

    // 2️⃣ close the PDFium document
    this.pageCache.pdf.FPDF_CloseDocument(this.docPtr);

    // 3️⃣ free the file handle through memory manager for proper tracking
    this.memoryManager.free(WasmPointer(this.filePtr));
  }
}

export class PageCache {
  private readonly cache = new Map<number, PageContext>();
  private readonly accessOrder: number[] = []; // LRU tracking
  private config: Required<CacheConfig>;
  /**
   * Objects soft-deleted via {@link setObjectsActive}, keyed pageIdx → id-key →
   * id-path. The "active" flag is a runtime property of a loaded page that is
   * lost when the page is reloaded (e.g. on REFRESH_PAGES), so we persist the
   * set here and re-apply it every time a page is (re)loaded.
   */
  private readonly inactiveObjects = new Map<number, Map<string, number[]>>();
  /**
   * Subpath-level erase state (line-wise eraser), keyed pageIdx → id-key →
   * desired state. Persisted for the same reason as {@link inactiveObjects}
   * and re-applied on every page (re)load. Mutually exclusive with a full
   * soft-delete per object id.
   */
  private readonly subpathOverrides = new Map<
    number,
    Map<string, { idPath: number[]; inactiveSubpaths: number[]; moves: Map<number, SubpathMovePage> }>
  >();
  /**
   * Live replacement-object pointers per loaded page, keyed pageIdx →
   * id-key → objPtr. Pointers die with the page handle, so entries are
   * dropped on page dispose and rebuilt by {@link applySubpathOverridesToPage}.
   */
  private readonly liveReplacements = new Map<number, Map<string, number>>();
  /**
   * Desired total translation per object (move), in PDF PAGE space (bottom-up),
   * keyed pageIdx → id-key → {idPath, pdx, pdy}. Persisted like the erase sets
   * and re-applied on page (re)load; `{0,0}` removes the entry.
   */
  private readonly transforms = new Map<
    number,
    Map<string, { idPath: number[]; pdx: number; pdy: number }>
  >();
  /**
   * Translation already applied to the CURRENTLY-loaded page handle, per
   * object. Lets {@link setObjectTranslation} apply only the delta on a live
   * page. Reset when the page handle is disposed (a fresh load starts from the
   * original positions).
   */
  private readonly appliedTransforms = new Map<number, Map<string, { pdx: number; pdy: number }>>();

  constructor(
    public readonly pdf: WrappedPdfiumModule,
    private readonly docPtr: number,
    config: Required<CacheConfig>,
    private readonly memoryManager: MemoryManager,
  ) {
    this.config = config;
  }

  /** Resolve an index-path id to a native page-object pointer (0 if absent). */
  private resolveObject(pagePtr: number, idPath: number[]): number {
    if (idPath.length === 0) return 0;
    let objPtr = this.pdf.FPDFPage_GetObject(pagePtr, idPath[0]);
    for (let i = 1; i < idPath.length && objPtr; i++) {
      objPtr = this.pdf.FPDFFormObj_GetObject(objPtr, idPath[i]);
    }
    return objPtr;
  }

  /** Re-apply the persisted inactive set to a freshly-loaded page. */
  private applyInactiveToPage(pageIdx: number, pagePtr: number): void {
    const set = this.inactiveObjects.get(pageIdx);
    if (!set) return;
    for (const idPath of set.values()) {
      const objPtr = this.resolveObject(pagePtr, idPath);
      if (objPtr) this.pdf.FPDFPageObj_SetIsActive(objPtr, false);
    }
  }

  /**
   * Toggle the active flag for the given objects on a page and remember the
   * choice so it survives page reloads. Returns true when every id resolved.
   */
  setObjectsActive(pageIdx: number, idPaths: number[][], active: boolean): boolean {
    let set = this.inactiveObjects.get(pageIdx);
    if (!set) {
      set = new Map<string, number[]>();
      this.inactiveObjects.set(pageIdx, set);
    }
    for (const idPath of idPaths) {
      const key = idPath.join(",");
      if (active) set.delete(key);
      else set.set(key, idPath.slice());
      this.clearSubpathOverride(pageIdx, key);
    }
    if (set.size === 0) this.inactiveObjects.delete(pageIdx);

    // Apply immediately to the currently-loaded handle, if any.
    const ctx = this.cache.get(pageIdx);
    if (!ctx) return true;
    let ok = true;
    for (const idPath of idPaths) {
      const objPtr = this.resolveObject(ctx.pagePtr, idPath);
      if (!objPtr || !this.pdf.FPDFPageObj_SetIsActive(objPtr, active)) ok = false;
    }
    return ok;
  }

  /**
   * Set the erased-subpaths state for the given path objects and remember it
   * so it survives page reloads. Set-state semantics per object: non-empty
   * `inactiveSubpaths` soft-deletes the original and (re)builds a replacement
   * containing only the kept subpaths; an empty array restores the original.
   * Returns true when every item applied to the loaded page (or the page is
   * not currently loaded — it will be applied on next load).
   */
  setPathSubpathsInactive(pageIdx: number, items: PdfPathSubpathErase[]): boolean {
    let ok = true;
    for (const item of items) {
      const key = item.id.join(",");
      // Subpath state supersedes a full soft-delete for the same object.
      const inactiveSet = this.inactiveObjects.get(pageIdx);
      if (inactiveSet?.delete(key) && inactiveSet.size === 0) {
        this.inactiveObjects.delete(pageIdx);
      }
      const entry = this.getOrCreateSubpathOverride(pageIdx, item.id);
      entry.inactiveSubpaths = item.inactiveSubpaths.slice();

      // Apply immediately to the currently-loaded handle, if any.
      const ctx = this.cache.get(pageIdx);
      if (ctx && !this.applySubpathState(pageIdx, ctx.pagePtr, key, entry)) ok = false;
      this.cleanupSubpathOverrideIfEmpty(pageIdx, key);
    }
    return ok;
  }

  /**
   * Set the desired total translation (PDF page space) of the given subpaths of
   * a path object — the move analogue of {@link setPathSubpathsInactive}. The
   * original is soft-deleted and replaced by a copy with those subpaths
   * translated (and any inactive ones still dropped); `{0,0}` clears their
   * moves. Persisted and re-applied on every page (re)load.
   */
  setSubpathTranslation(
    pageIdx: number,
    idPath: number[],
    subpaths: number[],
    pdx: number,
    pdy: number,
  ): boolean {
    const key = idPath.join(",");
    // Subpath state supersedes a full soft-delete for the same object.
    const inactiveSet = this.inactiveObjects.get(pageIdx);
    if (inactiveSet?.delete(key) && inactiveSet.size === 0) {
      this.inactiveObjects.delete(pageIdx);
    }
    const entry = this.getOrCreateSubpathOverride(pageIdx, idPath);
    for (const sp of subpaths) {
      if (pdx === 0 && pdy === 0) entry.moves.delete(sp);
      else entry.moves.set(sp, { pdx, pdy });
    }

    const ctx = this.cache.get(pageIdx);
    let ok = true;
    if (ctx && !this.applySubpathState(pageIdx, ctx.pagePtr, key, entry)) ok = false;
    this.cleanupSubpathOverrideIfEmpty(pageIdx, key);
    return ok;
  }

  /** Get (or create, empty) the combined subpath-override entry for an object. */
  private getOrCreateSubpathOverride(
    pageIdx: number,
    idPath: number[],
  ): { idPath: number[]; inactiveSubpaths: number[]; moves: Map<number, SubpathMovePage> } {
    let overrides = this.subpathOverrides.get(pageIdx);
    if (!overrides) {
      overrides = new Map();
      this.subpathOverrides.set(pageIdx, overrides);
    }
    const key = idPath.join(",");
    let entry = overrides.get(key);
    if (!entry) {
      entry = { idPath: idPath.slice(), inactiveSubpaths: [], moves: new Map() };
      overrides.set(key, entry);
    }
    return entry;
  }

  /** Drop a subpath override (and its page map) once it carries no state. */
  private cleanupSubpathOverrideIfEmpty(pageIdx: number, key: string): void {
    const overrides = this.subpathOverrides.get(pageIdx);
    const entry = overrides?.get(key);
    if (!overrides || !entry) return;
    if (entry.inactiveSubpaths.length === 0 && entry.moves.size === 0) {
      overrides.delete(key);
      if (overrides.size === 0) this.subpathOverrides.delete(pageIdx);
    }
  }

  /** Pointers of live subpath-replacement objects on the loaded page. */
  getReplacementPtrs(pageIdx: number): number[] {
    const live = this.liveReplacements.get(pageIdx);
    return live ? [...live.values()] : [];
  }

  /** Drop a persisted subpath override and its live replacement, if any. */
  private clearSubpathOverride(pageIdx: number, key: string): void {
    const overrides = this.subpathOverrides.get(pageIdx);
    if (overrides?.delete(key) && overrides.size === 0) {
      this.subpathOverrides.delete(pageIdx);
    }
    this.removeLiveReplacement(pageIdx, key);
  }

  /** Remove (and destroy) the live replacement object for `key`, if any. */
  private removeLiveReplacement(pageIdx: number, key: string): void {
    const live = this.liveReplacements.get(pageIdx);
    const ptr = live?.get(key);
    if (!live || ptr === undefined) return;
    const ctx = this.cache.get(pageIdx);
    if (ctx) {
      this.pdf.FPDFPage_RemoveObject(ctx.pagePtr, ptr);
      this.pdf.FPDFPageObj_Destroy(ptr);
    }
    live.delete(key);
    if (live.size === 0) this.liveReplacements.delete(pageIdx);
  }

  /** Apply one object's combined subpath state (erases + moves) to a loaded
   *  page handle: soft-delete the original and insert a replacement that drops
   *  the inactive subpaths and translates the moved ones; with neither, restore
   *  the original. */
  private applySubpathState(
    pageIdx: number,
    pagePtr: number,
    key: string,
    entry: { idPath: number[]; inactiveSubpaths: number[]; moves: Map<number, SubpathMovePage> },
  ): boolean {
    this.removeLiveReplacement(pageIdx, key);
    const objPtr = this.resolveObject(pagePtr, entry.idPath);
    if (!objPtr) return false;
    if (entry.inactiveSubpaths.length === 0 && entry.moves.size === 0) {
      return !!this.pdf.FPDFPageObj_SetIsActive(objPtr, true);
    }
    if (!this.pdf.FPDFPageObj_SetIsActive(objPtr, false)) return false;
    const newPtr = buildSubpathReplacement(
      this.pdf,
      this.memoryManager,
      pagePtr,
      objPtr,
      entry.idPath,
      new Set(entry.inactiveSubpaths),
      entry.moves,
    );
    // No kept subpaths → the soft-delete alone is the correct state.
    if (!newPtr) return true;
    this.pdf.FPDFPage_InsertObject(pagePtr, newPtr);
    let live = this.liveReplacements.get(pageIdx);
    if (!live) {
      live = new Map();
      this.liveReplacements.set(pageIdx, live);
    }
    live.set(key, newPtr);
    return true;
  }

  /** Re-apply persisted subpath erases + moves to a freshly-loaded page. */
  private applySubpathOverridesToPage(pageIdx: number, pagePtr: number): void {
    const overrides = this.subpathOverrides.get(pageIdx);
    if (!overrides) return;
    for (const [key, entry] of overrides) {
      this.applySubpathState(pageIdx, pagePtr, key, entry);
    }
  }

  /**
   * Set the desired total translation (PDF page space) of an object and apply
   * it to the loaded page by the delta from what's already applied. `{0,0}`
   * removes the persisted entry (and moves the object back). Returns true when
   * the object resolved on the loaded page (or the page isn't loaded — it'll
   * be applied on next load).
   */
  setObjectTranslation(pageIdx: number, idPath: number[], pdx: number, pdy: number): boolean {
    const key = idPath.join(",");
    let desired = this.transforms.get(pageIdx);
    if (!desired) {
      desired = new Map();
      this.transforms.set(pageIdx, desired);
    }
    if (pdx === 0 && pdy === 0) desired.delete(key);
    else desired.set(key, { idPath: idPath.slice(), pdx, pdy });
    if (desired.size === 0) this.transforms.delete(pageIdx);

    const ctx = this.cache.get(pageIdx);
    if (!ctx) return true;

    let applied = this.appliedTransforms.get(pageIdx);
    if (!applied) {
      applied = new Map();
      this.appliedTransforms.set(pageIdx, applied);
    }
    const prev = applied.get(key) ?? { pdx: 0, pdy: 0 };
    const ddx = pdx - prev.pdx;
    const ddy = pdy - prev.pdy;
    if (ddx !== 0 || ddy !== 0) {
      const objPtr = this.resolveObject(ctx.pagePtr, idPath);
      if (!objPtr) return false;
      // Translation in page space: matrix [1 0 0 1 ddx ddy].
      this.pdf.FPDFPageObj_Transform(objPtr, 1, 0, 0, 1, ddx, ddy);
    }
    if (pdx === 0 && pdy === 0) applied.delete(key);
    else applied.set(key, { pdx, pdy });
    if (applied.size === 0) this.appliedTransforms.delete(pageIdx);
    return true;
  }

  /** Re-apply persisted translations to a freshly-loaded page (from original). */
  private applyTransformsToPage(pageIdx: number, pagePtr: number): void {
    const desired = this.transforms.get(pageIdx);
    if (!desired) return;
    const applied = new Map<string, { pdx: number; pdy: number }>();
    for (const [key, t] of desired) {
      const objPtr = this.resolveObject(pagePtr, t.idPath);
      if (!objPtr) continue;
      this.pdf.FPDFPageObj_Transform(objPtr, 1, 0, 0, 1, t.pdx, t.pdy);
      applied.set(key, { pdx: t.pdx, pdy: t.pdy });
    }
    if (applied.size > 0) this.appliedTransforms.set(pageIdx, applied);
  }

  acquire(pageIdx: number): PageContext {
    let ctx = this.cache.get(pageIdx);

    if (!ctx) {
      // Ensure we don't exceed max cache size
      this.evictIfNeeded();

      let pagePtr: number;
      if (this.config.normalizeRotation) {
        // Load page with normalized rotation - all coords will be in 0° space
        // We pass 0 (null pointer) since rotation is already stored in PdfPageObject
        pagePtr = this.pdf.EPDF_LoadPageNormalized(this.docPtr, pageIdx, 0);
      } else {
        // Current behavior
        pagePtr = this.pdf.FPDF_LoadPage(this.docPtr, pageIdx);
      }

      ctx = new PageContext(this.pdf, this.docPtr, pageIdx, pagePtr, this.config.pageTtl, () => {
        this.cache.delete(pageIdx);
        this.removeFromAccessOrder(pageIdx);
        // Replacement pointers + applied transforms die with the page handle.
        this.liveReplacements.delete(pageIdx);
        this.appliedTransforms.delete(pageIdx);
      });
      this.cache.set(pageIdx, ctx);
      // Re-apply any persisted soft-deletes + subpath erases + moves to this
      // freshly-loaded page.
      this.applyInactiveToPage(pageIdx, pagePtr);
      this.applySubpathOverridesToPage(pageIdx, pagePtr);
      this.applyTransformsToPage(pageIdx, pagePtr);
    }

    // Update LRU order
    this.updateAccessOrder(pageIdx);

    ctx.clearExpiryTimer(); // cancel any pending teardown
    ctx.bumpRefCount(); // bump ref‐count
    return ctx;
  }

  /** Helper: run a function "scoped" to a page.
   *    – if the page was already cached  → .release() (keeps TTL logic)
   *    – if the page was loaded just now → .disposeImmediate() (free right away)
   */
  borrowPage<T>(pageIdx: number, fn: (ctx: PageContext) => T): T {
    const existed = this.cache.has(pageIdx);
    const ctx = this.acquire(pageIdx);
    try {
      return fn(ctx);
    } finally {
      existed ? ctx.release() : ctx.disposeImmediate();
    }
  }

  forceReleaseAll(): void {
    for (const ctx of this.cache.values()) {
      ctx.disposeImmediate();
    }
    this.cache.clear();
    this.accessOrder.length = 0;
  }

  /** Update cache configuration */
  updateConfig(config: Required<CacheConfig>): void {
    this.config = config;

    // Update TTL for all existing pages
    for (const ctx of this.cache.values()) {
      ctx.updateTtl(config.pageTtl);
    }

    // Evict pages if new max size is smaller
    this.evictIfNeeded();
  }

  /** Get current cache size */
  size(): number {
    return this.cache.size;
  }

  /** Evict least recently used pages if cache exceeds max size */
  private evictIfNeeded(): void {
    while (this.cache.size >= this.config.maxPagesPerDocument) {
      const lruPageIdx = this.accessOrder[0];
      if (lruPageIdx !== undefined) {
        const ctx = this.cache.get(lruPageIdx);
        if (ctx) {
          // Only evict if not currently in use (refCount === 0)
          if (ctx.getRefCount() === 0) {
            ctx.disposeImmediate();
            // onFinalDispose callback will remove from cache and accessOrder
          } else {
            // If the LRU page is in use, we can't evict it
            // Move to a different strategy or break to avoid infinite loop
            break;
          }
        } else {
          // Page not in cache but in access order - clean up
          this.removeFromAccessOrder(lruPageIdx);
        }
      } else {
        break;
      }
    }
  }

  /** Update the access order for LRU tracking */
  private updateAccessOrder(pageIdx: number): void {
    // Remove from current position
    this.removeFromAccessOrder(pageIdx);
    // Add to end (most recently used)
    this.accessOrder.push(pageIdx);
  }

  /** Remove a page from the access order array */
  private removeFromAccessOrder(pageIdx: number): void {
    const index = this.accessOrder.indexOf(pageIdx);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }
}

export class PageContext {
  private refCount = 0;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private ttl: number;

  // lazy helpers
  private textPagePtr?: number;
  private formInfoPtr?: number;
  private formHandle?: number;

  constructor(
    private readonly pdf: WrappedPdfiumModule,
    public readonly docPtr: number,
    public readonly pageIdx: number,
    public readonly pagePtr: number,
    ttl: number,
    private readonly onFinalDispose: () => void,
  ) {
    this.ttl = ttl;
  }

  /** Called by PageCache.acquire() */
  bumpRefCount() {
    if (this.disposed) throw new Error("Context already disposed");
    this.refCount++;
  }

  /** Get current reference count */
  getRefCount(): number {
    return this.refCount;
  }

  /** Called by PageCache.acquire() */
  clearExpiryTimer() {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }

  /** Update TTL configuration */
  updateTtl(newTtl: number): void {
    this.ttl = newTtl;
    // If there's an active timer and ref count is 0, restart with new TTL
    if (this.expiryTimer && this.refCount === 0) {
      this.clearExpiryTimer();
      this.expiryTimer = setTimeout(() => this.disposeImmediate(), this.ttl);
    }
  }

  /** Called by PageCache.release() internally */
  release() {
    if (this.disposed) return;
    this.refCount--;
    if (this.refCount === 0) {
      // schedule the one-and-only timer for the page
      this.expiryTimer = setTimeout(() => this.disposeImmediate(), this.ttl);
    }
  }

  /** Tear down _all_ sub-pointers & the page. */
  disposeImmediate() {
    if (this.disposed) return;
    this.disposed = true;

    // Clear any pending timer
    this.clearExpiryTimer();

    // 2️⃣ close text-page if opened
    if (this.textPagePtr !== undefined) {
      this.pdf.FPDFText_ClosePage(this.textPagePtr);
    }

    // 3️⃣ close form-fill if opened
    if (this.formHandle !== undefined) {
      this.pdf.FORM_OnBeforeClosePage(this.pagePtr, this.formHandle);
      this.pdf.PDFiumExt_ExitFormFillEnvironment(this.formHandle);
    }
    if (this.formInfoPtr !== undefined) {
      this.pdf.PDFiumExt_CloseFormFillInfo(this.formInfoPtr);
    }

    // 4️⃣ finally close the page itself
    this.pdf.FPDF_ClosePage(this.pagePtr);

    // 5️⃣ remove from the cache
    this.onFinalDispose();
  }

  // ── public helpers ──

  /** Always safe: opens (once) and returns the text-page ptr. */
  getTextPage(): number {
    this.ensureAlive();
    if (this.textPagePtr === undefined) {
      this.textPagePtr = this.pdf.FPDFText_LoadPage(this.pagePtr);
    }
    return this.textPagePtr;
  }

  /** Always safe: opens (once) and returns the form-fill handle. */
  getFormHandle(): number {
    this.ensureAlive();
    if (this.formHandle === undefined) {
      this.formInfoPtr = this.pdf.PDFiumExt_OpenFormFillInfo();
      this.formHandle = this.pdf.PDFiumExt_InitFormFillEnvironment(this.docPtr, this.formInfoPtr);
      this.pdf.FORM_OnAfterLoadPage(this.pagePtr, this.formHandle);
    }
    return this.formHandle;
  }

  /**
   * Safely execute `fn` with an annotation pointer.
   * Pointer is ALWAYS closed afterwards.
   */
  withAnnotation<T>(annotIdx: number, fn: (annotPtr: number) => T): T {
    this.ensureAlive();
    const annotPtr = this.pdf.FPDFPage_GetAnnot(this.pagePtr, annotIdx);
    try {
      return fn(annotPtr);
    } finally {
      this.pdf.FPDFPage_CloseAnnot(annotPtr);
    }
  }

  private ensureAlive() {
    if (this.disposed) throw new Error("PageContext already disposed");
  }
}
