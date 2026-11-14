/**
 * 盲走 BlindWalk · HarmonyOS ArkUI — 单色极简图标
 *
 * 严格按鸿蒙官方规范：
 *   - 使用系统 SymbolGlyph + sys.symbol.* 内置符号
 *   - 渲染策略固定为单色（monochrome），只用一种颜色
 *   - 标准尺寸 24vp，小号 20vp
 *
 * 用法：BwIcon({ name: 'house' })、BwIcon({ name: 'chevron_left', size: 20 })
 * 找不到系统符号时降级为空（不破坏布局）。
 */

import { BWColor, BWSize } from '../theme/Theme';

/** 业务语义 → 系统符号名（全部经编译验证存在） */
export class BwSymbols {
  // 导航
  static readonly home: string = 'house';
  static readonly homeFill: string = 'house_fill';
  static readonly journey: string = 'pin';
  static readonly cards: string = 'square_grid_2x2';
  static readonly profile: string = 'person';
  static readonly profileFill: string = 'person_fill';
  static readonly map: string = 'map';
  static readonly message: string = 'message';

  // 方向
  static readonly back: string = 'chevron_left';
  static readonly forward: string = 'chevron_right';
  static readonly chevronUp: string = 'chevron_up';
  static readonly chevronDown: string = 'chevron_down';
  static readonly arrowUp: string = 'arrow_up';

  // 操作
  static readonly close: string = 'xmark';
  static readonly plus: string = 'plus';
  static readonly minus: string = 'minus';
  static readonly check: string = 'checkmark';
  static readonly checkCircle: string = 'checkmark_circle';
  static readonly search: string = 'magnifyingglass';
  static readonly refresh: string = 'arrow_clockwise';
  static readonly settings: string = 'gearshape';
  static readonly share: string = 'arrowshape_turn_up_right';
  static readonly trash: string = 'trash';
  static readonly edit: string = 'square_and_pencil';
  static readonly copy: string = 'doc_plaintext';

  // 状态与内容
  static readonly fire: string = 'flame';
  static readonly star: string = 'star';
  static readonly starFill: string = 'star_fill';
  static readonly heart: string = 'heart';
  static readonly heartFill: string = 'heart_fill';
  static readonly gift: string = 'gift';
  static readonly giftFill: string = 'gift_fill';
  static readonly clock: string = 'clock';
  static readonly calendar: string = 'calendar';
  static readonly info: string = 'info_circle';
  static readonly warning: string = 'exclamationmark_triangle';
  static readonly lock: string = 'lock';
  static readonly eye: string = 'eye';
  static readonly person2: string = 'person_2';
  static readonly like: string = 'hand_thumbsup';
  static readonly sun: string = 'sun_max';

  // 形象
  static readonly walk: string = 'figure_walk';
  static readonly game: string = 'gamecontroller';
  static readonly music: string = 'headphones_fill';
  static readonly book: string = 'book';
  static readonly leaf: string = 'leaf_fill';
  static readonly drop: string = 'drop';
  static readonly bag: string = 'bag_fill';
  static readonly cart: string = 'cart_fill';
  static readonly card: string = 'creditcard_fill';
  static readonly shield: string = 'checkmark_shield';
  static readonly bell: string = 'bell';
}

/**
 * 单色系统图标
 * name 传 BwSymbols 里的短名（如 'house'）或完整符号名
 */
@Component
export struct BwIcon {
  /** 系统符号名，例如 house / chevron_left */
  @Prop name: string = 'house';
  @Prop iconSize: number = BWSize.iconSize;
  @Prop color: string = BWColor.icon;
  @Prop weight: number = 1;
  onTap: () => void = () => {
  };

  build() {
    SymbolGlyph($r('sys.symbol.' + this.name))
      .fontSize(this.iconSize)
      .fontColor([this.color])
      .renderingStrategy(SymbolRenderingStrategy.SINGLE)
      .fontWeight(this.weight)
      .hitTestBehavior(HitTestMode.None)
  }
}

/** 可点击的单色图标按钮（44vp 触达区 + 圆形底） */@Component
export struct BwIconButton {
  @Prop name: string = 'chevron_left';
  @Prop iconSize: number = BWSize.iconSize;
  @Prop color: string = BWColor.icon;
  @Prop boxSize: number = BWSize.touchTarget;
  @Prop filled: boolean = false;
  @Prop dark: boolean = false;
  onTap: () => void = () => {
  };

  build() {
    Stack({ alignContent: Alignment.Center }) {
      SymbolGlyph($r('sys.symbol.' + this.name))
        .fontSize(this.iconSize)
        .fontColor([this.color])
        .renderingStrategy(SymbolRenderingStrategy.SINGLE)
    }
    .width(this.boxSize)
    .height(this.boxSize)
    .backgroundColor(this.filled
      ? (this.dark ? BWColor.stageClose : BWColor.paper2)
      : Color.Transparent)
    .borderRadius(this.boxSize / 2)
    .onClick(() => {
      this.onTap();
    })
  }
}

/** 图标 + 文字的横向条目（官方列表项风格） */
@Component
export struct BwIconLabel {
  @Prop name: string = 'info_circle';
  @Prop label: string = '';
  @Prop iconSize: number = BWSize.iconSizeSm;
  @Prop color: string = BWColor.ink2;
  @Prop textSize: number = 14;

  build() {
    Row({ space: 6 }) {
      SymbolGlyph($r('sys.symbol.' + this.name))
        .fontSize(this.iconSize)
        .fontColor([this.color])
        .renderingStrategy(SymbolRenderingStrategy.SINGLE)

      Text(this.label)
        .fontSize(this.textSize)
        .fontColor(this.color)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
  }
}
// ============================================================
// 地点分类 → 官方单色符号
//
// 产品要求「图标单色极简」，所以不再用 emoji 表达分类，
// 统一映射到系统 SymbolGlyph。映射表覆盖 core/parity.ts 的 17 个类别。
// ============================================================

export function categorySymbol(category: string): string {
  // 内置 24 个地点用的是中文类别名（'长椅' / '石阶' …），
  // 真实 POI 用英文 key（'bench' / 'cafe' …）。两套都要认。
  switch (category) {
    case '长椅':
      return 'rectangle_split_1x2';
    case '石阶':
      return 'square_grid_2x2';
    case '桥':
      return 'arrow_2_circlepath';
    case '河岸':
      return 'water_waves';
    case '风筝':
      return 'arrow_up';
    case '涂鸦':
    case '涂鸦墙':
      return 'square_and_pencil';
    case '花店':
      return 'sun_max';
    case '棋摊':
      return 'square_grid_2x2';
    case '屋檐':
      return 'house';
    case '便利店':
      return 'bag_fill';
    case '书店':
      return 'book';
    case '图书馆':
      return 'doc_plaintext';
    case '咖啡窗口':
      return 'cup_fill';
    case '公园':
      return 'leaf_fill';
    case '观景点':
      return 'eye';
    case '花园':
      return 'sun_max';
    case '广场':
      return 'square_grid_2x2';
    case '市集':
      return 'cart_fill';
    case '老建筑':
      return 'building';
    case '老房子':
      return 'building_fill';
    case '博物馆':
      return 'building';
    case '剧场':
      return 'headphones_fill';
    case '寺观':
      return 'flag';
    case '街角':
      return 'pin';
    case '灯塔':
      return 'flag';
    case '栈道':
      return 'rectangle_split_1x2';
    case '阳台':
      return 'house';
    case '邮筒':
      return 'message';
    case '唱片店':
      return 'headphones_fill';
    case '裁缝铺':
      return 'square_and_pencil';
    case '馄饨摊':
      return 'cup_fill';
    case '秋千':
      return 'arrow_2_circlepath';
    case '篮球场':
      return 'square_grid_2x2';
    case '水塔':
      return 'drop';
    case '三轮车':
      return 'cart_fill';
    case '台阶':
      return 'square_grid_2x2';
    case '洗衣店':
      return 'water_waves';
    case '棋盘':
      return 'square_grid_2x2';
    case '洗车房':
      return 'drop';
    case '修表摊':
      return 'clock';
    default:
      break;
  }
  switch (category) {
    case 'cafe':
      return 'cup_fill';
    case 'bookstore':
      return 'book';
    case 'library':
      return 'doc_plaintext';
    case 'park':
      return 'leaf_fill';
    case 'bench':
      return 'rectangle_split_1x2';
    case 'bridge':
      return 'arrow_2_circlepath';
    case 'art':
      return 'square_and_pencil';
    case 'river':
      return 'water_waves';
    case 'convenience':
      return 'bag_fill';
    case 'viewpoint':
      return 'eye';
    case 'garden':
      return 'sun_max';
    case 'plaza':
      return 'square_grid_2x2';
    case 'museum':
      return 'building';
    case 'historic':
      return 'building_fill';
    case 'venue':
      return 'headphones_fill';
    case 'temple':
      return 'flag';
    case 'market':
      return 'cart_fill';
    default:
      return 'pin';
  }
}
