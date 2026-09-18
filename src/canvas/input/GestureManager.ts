/**
 * GestureManager.ts
 * Единая точка входа для распознавания жестов сенсорного экрана и стилуса.
 *
 * Поддерживает:
 * - Differentiate pointerType: 'mouse', 'pen', 'touch'
 * - Аппаратный Palm Rejection: пока активен хотя бы один pen-pointer, все touch-события игнорируются
 * - 2 пальца: совмещенный жест Pan + Pinch-to-Zoom (смещение центроида + отношение расстояния)
 * - 2 пальца: быстрый тап (<= 250ms, <= 12px, окно касания <= 100ms) -> Undo
 * - 3 пальца: быстрый тап (<= 250ms, <= 12px) -> Redo
 * - 1 палец: двойной тап -> сброс зума (zoom-to-fit / 100%)
 * - 1 палец: long-press (500ms без смещения)
 * - Буферизация и отмена паразитных точек при начале двухпальцевого жеста
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface PanZoomParams {
  dx: number;
  dy: number;
  scale: number;
  screenCenter: ScreenPoint;
}

export interface GestureCallbacks {
  /**
   * Панорамирование и зум (2 пальца)
   */
  onPanZoom?: (params: PanZoomParams) => void;

  /**
   * Быстрый тап 2 пальцами -> Undo (Ctrl+Z)
   */
  onUndo?: () => void;

  /**
   * Быстрый тап 3 пальцами -> Redo (Ctrl+Y)
   */
  onRedo?: () => void;

  /**
   * Двойной тап 1 пальцем -> сброс масштаба
   */
  onDoubleTap?: (screenPos: ScreenPoint) => void;

  /**
   * Долгое нажатие 1 пальцем (500ms) -> контекстное действие
   */
  onLongPress?: (screenPos: ScreenPoint) => void;

  /**
   * Одиночный указатель (перо, мышь или палец в режиме рисования)
   */
  onSinglePointerDown?: (e: PointerEvent | React.PointerEvent) => void;
  onSinglePointerMove?: (e: PointerEvent | React.PointerEvent) => void;
  onSinglePointerUp?: (e: PointerEvent | React.PointerEvent) => void;

  /**
   * Отмена активного предварительного штриха (например, когда 2-й палец коснулся или стилус отбросил тач)
   */
  onCancelActiveStroke?: () => void;
}

export interface GestureManagerOptions {
  /**
   * Разрешено ли рисование 1 пальцем.
   * Если true: 1 палец рисует (как в OneNote по умолчанию).
   * Если false: 1 палец панорамирует холст.
   */
  drawWithTouch?: boolean;

  /**
   * Порог длительности быстрого тапа (мс)
   */
  tapMaxDurationMs?: number;

  /**
   * Максимальное смещение пальца для тапа (px)
   */
  tapMaxDisplacementPx?: number;

  /**
   * Максимальное временное окно между касаниями нескольких пальцев (мс)
   */
  multiTapDownWindowMs?: number;

  /**
   * Время удержания для long-press (мс)
   */
  longPressDelayMs?: number;
}

interface TrackedPointer {
  id: number;
  pointerType: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startTime: number;
  lastX: number;
  lastY: number;
  maxDisplacement: number;
  isPalmRejected: boolean;
}

interface MultiFingerTapCandidate {
  fingerCount: 2 | 3;
  downTimes: number[];
  upTimes: number[];
  maxDisplacements: number[];
  startTime: number;
  isPanPinchTriggered: boolean;
  releasedCount: number;
}

export class GestureManager {
  private callbacks: GestureCallbacks;
  private options: Required<GestureManagerOptions>;

  // Активные стилусы
  private activePenPointers = new Set<number>();

  // Активные сенсорные указатели (touch)
  private activeTouchPointers = new Map<number, TrackedPointer>();

  // Отслеживание двухпальцевого панорамирования/зума
  private lastCentroid: ScreenPoint | null = null;
  private lastDistance: number = 0;
  private isPinchPanning = false;

  // Отслеживание быстрого тапа 2/3 пальцами
  private tapCandidate: MultiFingerTapCandidate | null = null;

  // Отслеживание одиночного пальца
  private singleTouchId: number | null = null;
  private singleTouchStartTime: number = 0;
  private singleTouchStartX: number = 0;
  private singleTouchStartY: number = 0;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  // Отслеживание двойного тапа 1 пальцем
  private lastSingleTapTime = 0;
  private lastSingleTapPos: ScreenPoint = { x: 0, y: 0 };

  constructor(callbacks: GestureCallbacks, options: GestureManagerOptions = {}) {
    this.callbacks = callbacks;
    this.options = {
      drawWithTouch: options.drawWithTouch ?? true,
      tapMaxDurationMs: options.tapMaxDurationMs ?? 250,
      tapMaxDisplacementPx: options.tapMaxDisplacementPx ?? 12,
      multiTapDownWindowMs: options.multiTapDownWindowMs ?? 100,
      longPressDelayMs: options.longPressDelayMs ?? 500,
    };
  }

  public updateOptions(newOptions: Partial<GestureManagerOptions>): void {
    this.options = {
      ...this.options,
      ...newOptions,
    };
  }

  public getOptions(): Required<GestureManagerOptions> {
    return this.options;
  }

  public isPalmRejectionActive(): boolean {
    return this.activePenPointers.size > 0;
  }

  public isPinchZoomActive(): boolean {
    return this.isPinchPanning;
  }

  public getActiveTouchCount(): number {
    return this.activeTouchPointers.size;
  }

  /**
   * Обработчик PointerDown
   */
  public handlePointerDown(e: PointerEvent | React.PointerEvent): void {
    const { pointerType, pointerId, clientX, clientY } = e;

    // 1. Мышь: обходит обработчик жестов, направляется напрямую в одиночный указатель
    if (pointerType === 'mouse') {
      this.callbacks.onSinglePointerDown?.(e);
      return;
    }

    // 2. Стилус (Pen):
    if (pointerType === 'pen') {
      this.activePenPointers.add(pointerId);

      // Palm Rejection: если пальцы уже касались экрана, отменяем их немедленно
      if (this.activeTouchPointers.size > 0) {
        for (const touch of this.activeTouchPointers.values()) {
          touch.isPalmRejected = true;
        }
        this.clearLongPressTimer();
        this.tapCandidate = null;
        this.resetTwoFingerState();
        this.callbacks.onCancelActiveStroke?.();
      }

      this.callbacks.onSinglePointerDown?.(e);
      return;
    }

    // 3. Палец (Touch):
    // Проверяем Palm Rejection: если стилус уже на экране, палец полностью блокируется
    if (this.activePenPointers.size > 0) {
      this.activeTouchPointers.set(pointerId, {
        id: pointerId,
        pointerType,
        startX: clientX,
        startY: clientY,
        currentX: clientX,
        currentY: clientY,
        startTime: Date.now(),
        lastX: clientX,
        lastY: clientY,
        maxDisplacement: 0,
        isPalmRejected: true,
      });
      return;
    }

    const now = Date.now();
    const newTouch: TrackedPointer = {
      id: pointerId,
      pointerType,
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      currentY: clientY,
      startTime: now,
      lastX: clientX,
      lastY: clientY,
      maxDisplacement: 0,
      isPalmRejected: false,
    };
    this.activeTouchPointers.set(pointerId, newTouch);

    const touchCount = this.activeTouchPointers.size;

    if (touchCount === 1) {
      this.singleTouchId = pointerId;
      this.singleTouchStartTime = now;
      this.singleTouchStartX = clientX;
      this.singleTouchStartY = clientY;

      // Проверяем двойной тап 1 пальцем
      const timeSinceLastTap = now - this.lastSingleTapTime;
      const distFromLastTap = Math.hypot(
        clientX - this.lastSingleTapPos.x,
        clientY - this.lastSingleTapPos.y
      );

      if (timeSinceLastTap < 320 && distFromLastTap < 24) {
        this.clearLongPressTimer();
        this.lastSingleTapTime = 0;
        this.callbacks.onCancelActiveStroke?.();
        this.callbacks.onDoubleTap?.({ x: clientX, y: clientY });
        return;
      }

      // Запускаем таймер Long-press
      this.clearLongPressTimer();
      this.longPressTimer = setTimeout(() => {
        if (
          this.activeTouchPointers.size === 1 &&
          this.singleTouchId === pointerId
        ) {
          const pt = this.activeTouchPointers.get(pointerId);
          if (pt && pt.maxDisplacement <= this.options.tapMaxDisplacementPx) {
            this.callbacks.onCancelActiveStroke?.();
            this.callbacks.onLongPress?.({ x: pt.currentX, y: pt.currentY });
          }
        }
      }, this.options.longPressDelayMs);

      // Если разрешено рисование пальцем — начинаем штрих
      if (this.options.drawWithTouch) {
        this.callbacks.onSinglePointerDown?.(e);
      }
    } else if (touchCount === 2) {
      // Появился второй палец!
      this.clearLongPressTimer();

      // Если первый палец только-только начал штрих (< 120мс назад и сдвинулся <= 14px),
      // отменяем случайную "точку" от первого пальца!
      const firstTouch = Array.from(this.activeTouchPointers.values())[0];
      if (firstTouch && (now - firstTouch.startTime < 130) && firstTouch.maxDisplacement <= 14) {
        this.callbacks.onCancelActiveStroke?.();
      }

      const touches = Array.from(this.activeTouchPointers.values());
      const p1 = touches[0];
      const p2 = touches[1];

      const initialCentroid = {
        x: (p1.currentX + p2.currentX) / 2,
        y: (p1.currentY + p2.currentY) / 2,
      };
      const initialDistance = Math.hypot(
        p1.currentX - p2.currentX,
        p1.currentY - p2.currentY
      );

      this.lastCentroid = initialCentroid;
      this.lastDistance = initialDistance;
      this.isPinchPanning = false;

      // Инициализируем кандидата на 2-finger tap (Undo)
      this.tapCandidate = {
        fingerCount: 2,
        downTimes: [p1.startTime, p2.startTime],
        upTimes: [],
        maxDisplacements: [p1.maxDisplacement, p2.maxDisplacement],
        startTime: now,
        isPanPinchTriggered: false,
        releasedCount: 0,
      };
    } else if (touchCount === 3) {
      // Третий палец (Redo)
      this.clearLongPressTimer();
      this.callbacks.onCancelActiveStroke?.();
      this.resetTwoFingerState();

      const touches = Array.from(this.activeTouchPointers.values());
      this.tapCandidate = {
        fingerCount: 3,
        downTimes: touches.map((t) => t.startTime),
        upTimes: [],
        maxDisplacements: touches.map((t) => t.maxDisplacement),
        startTime: now,
        isPanPinchTriggered: false,
        releasedCount: 0,
      };
    } else {
      // 4+ пальцев: игнорируем/сбрасываем
      this.clearLongPressTimer();
      this.tapCandidate = null;
      this.resetTwoFingerState();
    }
  }

  /**
   * Обработчик PointerMove
   */
  public handlePointerMove(e: PointerEvent | React.PointerEvent): void {
    const { pointerType, pointerId, clientX, clientY } = e;

    // 1. Мышь
    if (pointerType === 'mouse') {
      this.callbacks.onSinglePointerMove?.(e);
      return;
    }

    // 2. Стилус (Pen)
    if (pointerType === 'pen') {
      this.callbacks.onSinglePointerMove?.(e);
      return;
    }

    // 3. Палец (Touch)
    const tracked = this.activeTouchPointers.get(pointerId);
    if (!tracked || tracked.isPalmRejected) {
      return;
    }

    tracked.currentX = clientX;
    tracked.currentY = clientY;
    const displacement = Math.hypot(
      clientX - tracked.startX,
      clientY - tracked.startY
    );
    if (displacement > tracked.maxDisplacement) {
      tracked.maxDisplacement = displacement;
    }

    const touchCount = this.activeTouchPointers.size;

    if (touchCount === 1) {
      if (displacement > this.options.tapMaxDisplacementPx) {
        this.clearLongPressTimer();
      }

      if (this.options.drawWithTouch) {
        this.callbacks.onSinglePointerMove?.(e);
      } else {
        // Режим без рисования пальцем: 1 палец панорамирует холст
        const dx = clientX - tracked.lastX;
        const dy = clientY - tracked.lastY;
        this.callbacks.onPanZoom?.({
          dx,
          dy,
          scale: 1,
          screenCenter: { x: clientX, y: clientY },
        });
      }

      tracked.lastX = clientX;
      tracked.lastY = clientY;
      return;
    }

    if (touchCount === 2) {
      this.clearLongPressTimer();
      const touches = Array.from(this.activeTouchPointers.values());
      const p1 = touches[0];
      const p2 = touches[1];

      const maxDisp = Math.max(p1.maxDisplacement, p2.maxDisplacement);

      // Если смещение превысило порог тапа — переходим в Pan / Pinch Zoom
      if (maxDisp > this.options.tapMaxDisplacementPx) {
        if (this.tapCandidate) {
          this.tapCandidate.isPanPinchTriggered = true;
        }
        this.isPinchPanning = true;

        const currentCentroid: ScreenPoint = {
          x: (p1.currentX + p2.currentX) / 2,
          y: (p1.currentY + p2.currentY) / 2,
        };
        const currentDistance = Math.hypot(
          p1.currentX - p2.currentX,
          p1.currentY - p2.currentY
        );

        if (this.lastCentroid && this.lastDistance > 0) {
          const dx = currentCentroid.x - this.lastCentroid.x;
          const dy = currentCentroid.y - this.lastCentroid.y;
          const scale = currentDistance / this.lastDistance;

          this.callbacks.onPanZoom?.({
            dx,
            dy,
            scale,
            screenCenter: currentCentroid,
          });
        }

        this.lastCentroid = currentCentroid;
        this.lastDistance = currentDistance;
      }
      return;
    }

    if (touchCount === 3) {
      if (this.tapCandidate) {
        const touches = Array.from(this.activeTouchPointers.values());
        const maxDisp = Math.max(...touches.map((t) => t.maxDisplacement));
        if (maxDisp > this.options.tapMaxDisplacementPx) {
          this.tapCandidate.isPanPinchTriggered = true;
        }
      }
    }
  }

  /**
   * Обработчик PointerUp / PointerCancel / PointerLeave
   */
  public handlePointerUp(e: PointerEvent | React.PointerEvent): void {
    const { pointerType, pointerId, clientX, clientY } = e;

    // 1. Мышь
    if (pointerType === 'mouse') {
      this.callbacks.onSinglePointerUp?.(e);
      return;
    }

    // 2. Стилус (Pen)
    if (pointerType === 'pen') {
      this.activePenPointers.delete(pointerId);
      this.callbacks.onSinglePointerUp?.(e);
      return;
    }

    // 3. Палец (Touch)
    const tracked = this.activeTouchPointers.get(pointerId);
    if (!tracked) return;

    const now = Date.now();
    const isPalm = tracked.isPalmRejected;
    const initialTouchCount = this.activeTouchPointers.size;

    // Удаляем из активных
    this.activeTouchPointers.delete(pointerId);

    if (isPalm) {
      return;
    }

    // Проверка кандидата на мультитач тап (Undo / Redo)
    if (this.tapCandidate) {
      this.tapCandidate.upTimes.push(now);
      this.tapCandidate.maxDisplacements.push(tracked.maxDisplacement);
      this.tapCandidate.releasedCount += 1;

      // Когда все пальцы кандидата оторваны от экрана:
      if (this.tapCandidate.releasedCount >= this.tapCandidate.fingerCount) {
        const candidate = this.tapCandidate;
        this.tapCandidate = null;
        this.resetTwoFingerState();

        const duration = now - candidate.startTime;
        const maxDisp = Math.max(...candidate.maxDisplacements);
        const downDiff = Math.max(...candidate.downTimes) - Math.min(...candidate.downTimes);

        const isQuickTap =
          !candidate.isPanPinchTriggered &&
          duration <= this.options.tapMaxDurationMs &&
          maxDisp <= this.options.tapMaxDisplacementPx &&
          downDiff <= this.options.multiTapDownWindowMs;

        if (isQuickTap) {
          if (candidate.fingerCount === 2) {
            this.callbacks.onUndo?.();
            return;
          }
          if (candidate.fingerCount === 3) {
            this.callbacks.onRedo?.();
            return;
          }
        }
      }
      return;
    }

    // Завершение одиночного пальца
    if (initialTouchCount === 1) {
      this.clearLongPressTimer();

      if (this.options.drawWithTouch) {
        this.callbacks.onSinglePointerUp?.(e);
      }

      // Фиксируем тап для возможного последующего двойного тапа
      const duration = now - this.singleTouchStartTime;
      const disp = Math.hypot(
        clientX - this.singleTouchStartX,
        clientY - this.singleTouchStartY
      );

      if (duration < 280 && disp <= this.options.tapMaxDisplacementPx) {
        this.lastSingleTapTime = now;
        this.lastSingleTapPos = { x: clientX, y: clientY };
      }
      return;
    }

    if (this.activeTouchPointers.size === 0) {
      this.resetTwoFingerState();
      this.tapCandidate = null;
    }
  }

  /**
   * Сброс всех внутренних состояний
   */
  public reset(): void {
    this.clearLongPressTimer();
    this.activePenPointers.clear();
    this.activeTouchPointers.clear();
    this.resetTwoFingerState();
    this.tapCandidate = null;
    this.singleTouchId = null;
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private resetTwoFingerState(): void {
    this.lastCentroid = null;
    this.lastDistance = 0;
    this.isPinchPanning = false;
  }
}
