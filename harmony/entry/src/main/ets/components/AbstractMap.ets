/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 抽象街区地图
 *
 * design-system §5.3：奶油纸上的手绘街区（几条路、河、小方块建筑），
 * 一条虚线路线从底部「你」出发向前弯曲；路线上方一个呼吸光点 + 「?」，**没有终点名**。
 *
 * 用 Canvas 2D 绘制（不接地图瓦片），marker 用组件叠层，方便做呼吸动画。
 * ⚠️ 待 DevEco 验证：CanvasRenderingContext2D 的字体/lineDash 写法。
 */

import { BWColor, BWFont, BWSize } from '../theme/Theme';

interface MapDot {
  x: number;
  y: number;
}

@Component
export struct BwAbstractMap {
  @Prop @Watch('onProgressChanged') progress: number = 0;
  @Prop realMode: boolean = false;
  @State private mapWidth: number = 0;
  @State private mapHeight: number = 0;
  @State private pulse: boolean = false;
  private ready: boolean = false;
  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);

  aboutToAppear(): void {
    animateTo({
      duration: 2400,
      curve: Curve.EaseInOut,
      iterations: -1,
      playMode: PlayMode.Alternate
    }, () => {
      this.pulse = true;
    });
  }

  onProgressChanged(propName: string): void {
    this.draw();
  }

  /** 起点 / 控制点 / 终点（归一化） */
  private startDot(): MapDot {
    return { x: this.mapWidth * 0.54, y: this.mapHeight * 0.92 };
  }

  private controlDot(): MapDot {
    return { x: this.mapWidth * 0.14, y: this.mapHeight * 0.58 };
  }

  private endDot(): MapDot {
    return { x: this.mapWidth * 0.30, y: this.mapHeight * 0.20 };
  }

  /** 二次贝塞尔取点 */
  private bezier(dotStart: MapDot, dotControl: MapDot, dotEnd: MapDot, t: number): MapDot {
    const u: number = 1 - t;
    return {
      x: u * u * dotStart.x + 2 * u * t * dotControl.x + t * t * dotEnd.x,
      y: u * u * dotStart.y + 2 * u * t * dotControl.y + t * t * dotEnd.y
    };
  }

  private routeProgress(): number {
    return Math.max(0.06, Math.min(0.9, this.progress));
  }

  private currentDot(): MapDot {
    return this.bezier(this.startDot(), this.controlDot(), this.endDot(), this.routeProgress());
  }

  private draw(): void {
    if (!this.ready || this.mapWidth <= 0 || this.mapHeight <= 0) {
      return;
    }
    const ctx: CanvasRenderingContext2D = this.ctx;
    const w: number = this.mapWidth;
    const h: number = this.mapHeight;

    ctx.clearRect(0, 0, w, h);

    // 纸底
    ctx.fillStyle = BWColor.cream;
    ctx.fillRect(0, 0, w, h);

    // 河（两条：宽水面 + 细虚线）
    ctx.strokeStyle = 'rgba(46, 125, 120, 0.10)';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * 1.06);
    ctx.quadraticCurveTo(w * 0.04, h * 0.70, w * 0.34, h * 0.56);
    ctx.quadraticCurveTo(w * 0.54, h * 0.30, w * 0.16, -h * 0.06);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(46, 125, 120, 0.20)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 小方块建筑
    const blocks: number[][] = [
      [0.06, 0.10, 0.13, 0.07],
      [0.24, 0.08, 0.10, 0.06],
      [0.40, 0.12, 0.16, 0.06],
      [0.62, 0.08, 0.12, 0.07],
      [0.80, 0.14, 0.14, 0.06],
      [0.10, 0.34, 0.10, 0.06],
      [0.46, 0.36, 0.12, 0.07],
      [0.66, 0.32, 0.16, 0.06],
      [0.86, 0.38, 0.10, 0.07],
      [0.18, 0.60, 0.12, 0.06],
      [0.38, 0.62, 0.10, 0.07],
      [0.58, 0.58, 0.14, 0.06],
      [0.78, 0.64, 0.12, 0.06],
      [0.06, 0.78, 0.10, 0.06],
      [0.30, 0.80, 0.14, 0.05],
      [0.68, 0.80, 0.12, 0.06]
    ];
    ctx.fillStyle = 'rgba(166, 156, 140, 0.16)';
    ctx.strokeStyle = 'rgba(232, 222, 204, 0.9)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < blocks.length; i++) {
      const spec: number[] = blocks[i];
      const x: number = w * spec[0];
      const y: number = h * spec[1];
      const bw: number = w * spec[2];
      const bh: number = h * spec[3];
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeRect(x, y, bw, bh);
    }

    // 街道：先铺宽纸色路，再画虚线中线
    ctx.strokeStyle = BWColor.paper;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const y: number = h * (0.24 + i * 0.24);
      ctx.moveTo(-12, y + h * 0.02);
      ctx.quadraticCurveTo(w * 0.55, y + h * 0.07, w + 12, y - h * 0.02);
    }
    for (let i = 0; i < 2; i++) {
      const x: number = w * (0.26 + i * 0.42);
      ctx.moveTo(x, -12);
      ctx.quadraticCurveTo(x - w * 0.06, h * 0.5, x + w * 0.05, h + 12);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(166, 156, 140, 0.30)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 路线：已走 = 实线琥珀；剩余 = 虚线
    const dotStart: MapDot = this.startDot();
    const dotControl: MapDot = this.controlDot();
    const dotEnd: MapDot = this.endDot();
    const routeProgress: number = this.routeProgress();
    const steps: number = 60;

    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t: number = (i / steps) * routeProgress;
      const dot: MapDot = this.bezier(dotStart, dotControl, dotEnd, t);
      if (i === 0) {
        ctx.moveTo(dot.x, dot.y);
      } else {
        ctx.lineTo(dot.x, dot.y);
      }
    }
    ctx.strokeStyle = 'rgba(232, 155, 76, 1)';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t: number = routeProgress + (i / steps) * (1 - routeProgress);
      const dot: MapDot = this.bezier(dotStart, dotControl, dotEnd, t);
      if (i === 0) {
        ctx.moveTo(dot.x, dot.y);
      } else {
        ctx.lineTo(dot.x, dot.y);
      }
    }
    ctx.strokeStyle = 'rgba(166, 156, 140, 0.75)';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([6, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      Canvas(this.ctx)
        .width('100%')
        .height('100%')
        .onReady(() => {
          this.ready = true;
          this.draw();
        })

      // 呼吸光点 + 「?」（目的地保密：只有问号）
      Stack({ alignContent: Alignment.Center }) {
        Circle()
          .width(this.pulse ? 54 : 42)
          .height(this.pulse ? 54 : 42)
          .fill(this.pulse ? '#4DE89B4C' : '#2EE89B4C')
          .blur(10)

        Circle()
          .width(30)
          .height(30)
          .fill(BWColor.paper)
          .stroke(BWColor.amberDeep)
          .strokeWidth(1.5)

        Text('?')
          .fontSize(BWFont.titleSm)
          .fontWeight(FontWeight.Bold)
          .fontColor(BWColor.amberDeep)
      }
      .width(54)
      .height(54)
      .position({
        x: this.mapWidth * 0.30 - 27,
        y: this.mapHeight * 0.20 - 27
      })

      // 「你」标记（沿路线前进）
      Column({ space: 2 }) {
        Stack({ alignContent: Alignment.Center }) {
          Circle()
            .width(26)
            .height(26)
            .fill(BWColor.paper)
            .stroke(BWColor.amberDeep)
            .strokeWidth(1.6)

          Text('你')
            .fontSize(BWFont.microSm)
            .fontWeight(FontWeight.Bold)
            .fontColor(BWColor.amberDeep)
        }

        Row()
          .width(18)
          .height(4)
          .backgroundColor(BWColor.inkSoft)
          .borderRadius(2)
      }
      .width(40)
      .position({
        x: this.currentDot().x - 20,
        y: this.currentDot().y - 18
      })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(BWColor.cream)
    .borderRadius(BWSize.cardRadius)
    .border({ width: 1, color: BWColor.line, radius: BWSize.cardRadius })
    .clip(true)
    .onAreaChange((oldValue: Area, newValue: Area) => {
      this.mapWidth = parseFloat(newValue.width.toString());
      this.mapHeight = parseFloat(newValue.height.toString());
      this.draw();
    })
  }
}
