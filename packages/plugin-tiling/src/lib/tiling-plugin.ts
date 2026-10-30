import {
  BasePlugin,
  createBehaviorEmitter,
  Listener,
  PluginRegistry,
  REFRESH_PAGES,
  RefreshPagesAction,
} from '@embedpdf/core';
import { ignore, Rect } from '@embedpdf/models';
import { RenderCapability, RenderPlugin } from '@embedpdf/plugin-render';
import {
  ScrollCapability,
  ScrollMetrics,
  ScrollPlugin,
  ScrollEvent,
} from '@embedpdf/plugin-scroll';
import { ViewportCapability, ViewportPlugin } from '@embedpdf/plugin-viewport';

import { initTilingState, cleanupTilingState, markTileStatus, updateVisibleTiles } from './actions';
import { initialTilingDocumentState } from './reducer';
import {
  TilingPluginConfig,
  TilingCapability,
  Tile,
  RenderTileOptions,
  TilingState,
  TilingEvent,
  TilingScope,
} from './types';
import { calculateTilesForPage } from './utils';

/** Axis-aligned overlap test in the shared unrotated page-point space. */
function rectIntersectsRect(a: Rect, b: Rect): boolean {
  return (
    a.origin.x < b.origin.x + b.size.width &&
    a.origin.x + a.size.width > b.origin.x &&
    a.origin.y < b.origin.y + b.size.height &&
    a.origin.y + a.size.height > b.origin.y
  );
}

export class TilingPlugin extends BasePlugin<TilingPluginConfig, TilingCapability, TilingState> {
  static readonly id = 'tiling' as const;

  private readonly tileRendering$ = createBehaviorEmitter<TilingEvent>();

  private config: TilingPluginConfig;
  private renderCapability: RenderCapability;
  private scrollCapability: ScrollCapability;
  private viewportCapability: ViewportCapability;

  constructor(id: string, registry: PluginRegistry, config: TilingPluginConfig) {
    super(id, registry);

    this.config = config;

    this.renderCapability = this.registry.getPlugin<RenderPlugin>('render')!.provides();
    this.scrollCapability = this.registry.getPlugin<ScrollPlugin>('scroll')!.provides();
    this.viewportCapability = this.registry.getPlugin<ViewportPlugin>('viewport')!.provides();

    this.scrollCapability.onScroll(
      (event: ScrollEvent) => this.calculateVisibleTiles(event.documentId, event.metrics),
      {
        mode: 'throttle',
        wait: 50,
        throttleMode: 'trailing',
      },
    );

    this.coreStore.onAction(REFRESH_PAGES, (action) => this.recalculateTiles(action.payload));
  }

  protected override onDocumentLoadingStarted(documentId: string): void {
    this.dispatch(initTilingState(documentId, initialTilingDocumentState));
  }

  protected override onDocumentClosed(documentId: string): void {
    this.dispatch(cleanupTilingState(documentId));
  }

  protected override onScaleChanged(documentId: string): void {
    this.recalculateTilesForDocument(documentId);
  }

  protected override onRotationChanged(documentId: string): void {
    this.recalculateTilesForDocument(documentId);
  }

  private recalculateTilesForDocument(documentId: string): void {
    const scrollScope = this.scrollCapability.forDocument(documentId);
    const viewportScope = this.viewportCapability.forDocument(documentId);
    const metrics = scrollScope.getMetrics(viewportScope.getMetrics());
    this.calculateVisibleTiles(documentId, metrics);
  }

  async recalculateTiles(payload: RefreshPagesAction['payload']): Promise<void> {
    const { documentId, pageIndexes, dirtyRects } = payload;
    const coreDoc = this.getCoreDocument(documentId);
    if (!coreDoc || !coreDoc.document) return;

    const scrollScope = this.scrollCapability.forDocument(documentId);
    const viewportScope = this.viewportCapability.forDocument(documentId);
    const currentMetrics = scrollScope.getMetrics(viewportScope.getMetrics());

    // Recalculate tiles for refreshed pages with a new timestamp
    const refreshedTiles: Record<number, Tile[]> = {};
    const refreshTimestamp = Date.now();
    const scale = coreDoc.scale;
    const currentTiles = this.state.documents[documentId]?.visibleTiles ?? {};

    for (const pageIndex of pageIndexes) {
      const metric = currentMetrics.pageVisibilityMetrics.find(
        (m) => m.pageNumber === pageIndex + 1,
      );
      if (!metric) continue;

      const page = coreDoc.document.pages[pageIndex];
      if (!page) continue;

      // Calculate effective rotation for this page (page intrinsic + document rotation)
      const effectiveRotation = ((page.rotation ?? 0) + coreDoc.rotation) % 4;

      const freshTiles = calculateTilesForPage({
        page,
        metric,
        scale,
        rotation: effectiveRotation,
        tileSize: this.config.tileSize,
        overlapPx: this.config.overlapPx,
        extraRings: this.config.extraRings,
      });

      const rects = dirtyRects?.[pageIndex];
      if (!rects || rects.length === 0) {
        refreshedTiles[pageIndex] = freshTiles.map((tile) => ({
          ...tile,
          id: `${tile.id}-r${refreshTimestamp}`, // Add refresh token to force new render
        }));
        continue;
      }

      // Incremental refresh: only tiles intersecting a dirty rect get a new
      // id (and thus a re-render); clean tiles inherit their CURRENT id so
      // the reducer keeps them — including any refresh token from an earlier
      // refresh — and their canvases are left untouched.
      const currentIdByCell = new Map<string, string>();
      for (const t of currentTiles[pageIndex] ?? []) {
        if (!t.isFallback) currentIdByCell.set(`${t.col}:${t.row}:${t.srcScale}`, t.id);
      }
      refreshedTiles[pageIndex] = freshTiles.map((tile) => {
        if (rects.some((r) => rectIntersectsRect(r, tile.pageRect))) {
          return { ...tile, id: `${tile.id}-r${refreshTimestamp}` };
        }
        const existingId = currentIdByCell.get(`${tile.col}:${tile.row}:${tile.srcScale}`);
        return existingId ? { ...tile, id: existingId } : tile;
      });
    }

    if (Object.keys(refreshedTiles).length > 0) {
      this.dispatch(updateVisibleTiles(documentId, refreshedTiles));
    }
  }

  async initialize(): Promise<void> {
    // Fetch dependencies from the registry if needed
  }

  private calculateVisibleTiles(documentId: string, scrollMetrics: ScrollMetrics): void {
    const coreDoc = this.getCoreDocument(documentId);
    if (!coreDoc || !coreDoc.document) return;

    const scale = coreDoc.scale;
    const visibleTiles: { [pageIndex: number]: Tile[] } = {};

    for (const scrollMetric of scrollMetrics.pageVisibilityMetrics) {
      const pageIndex = scrollMetric.pageNumber - 1; // Convert to 0-based index
      const page = coreDoc.document.pages[pageIndex];
      if (!page) continue;

      // Calculate effective rotation for this page (page intrinsic + document rotation)
      const effectiveRotation = ((page.rotation ?? 0) + coreDoc.rotation) % 4;

      // Calculate tiles for the page using the utility function
      const tiles = calculateTilesForPage({
        page,
        metric: scrollMetric,
        scale,
        rotation: effectiveRotation,
        tileSize: this.config.tileSize,
        overlapPx: this.config.overlapPx,
        extraRings: this.config.extraRings,
      });

      visibleTiles[pageIndex] = tiles;
    }

    this.dispatch(updateVisibleTiles(documentId, visibleTiles));
  }

  override onStoreUpdated(prevState: TilingState, newState: TilingState): void {
    for (const documentId in newState.documents) {
      const prevDoc = prevState.documents[documentId];
      const newDoc = newState.documents[documentId];
      if (prevDoc !== newDoc) {
        this.tileRendering$.emit({ documentId, tiles: newDoc.visibleTiles });
      }
    }
  }

  protected buildCapability(): TilingCapability {
    return {
      renderTile: this.renderTile.bind(this),
      forDocument: this.createTilingScope.bind(this),
      onTileRendering: this.tileRendering$.on,
    };
  }

  private createTilingScope(documentId: string): TilingScope {
    return {
      renderTile: (options) => this.renderTile(options, documentId),
      onTileRendering: (listener: Listener<Record<number, Tile[]>>) =>
        this.tileRendering$.on((event) => {
          if (event.documentId === documentId) listener(event.tiles);
        }),
    };
  }

  private renderTile(options: RenderTileOptions, documentId?: string) {
    const id = documentId ?? this.getActiveDocumentId();
    if (!this.renderCapability) {
      throw new Error('Render capability not available.');
    }

    this.dispatch(markTileStatus(id, options.pageIndex, options.tile.id, 'rendering'));

    const task = this.renderCapability.forDocument(id).renderPageRectBitmap({
      pageIndex: options.pageIndex,
      rect: options.tile.pageRect,
      options: {
        scaleFactor: options.tile.srcScale,
        dpr: options.dpr,
      },
    });

    task.wait(() => {
      this.dispatch(markTileStatus(id, options.pageIndex, options.tile.id, 'ready'));
    }, ignore);

    return task;
  }
}
