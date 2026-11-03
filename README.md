# 我家冰箱 · What2Eat

一个离线可用的「冰箱库存 + 三餐计划 + 买菜清单」小工具。纯前端、零依赖、不需要联网，
数据存在浏览器本地（localStorage），刷新和关掉都不会丢。

当前版本：**手机竖屏版 v0.9**。浏览器里 PC 只是预览壳（宽屏下居中显示一条 430px 的手机画布，所见即所得）；
安卓安装包是同一个页面套了个 WebView 壳，视觉一模一样，见 `what2eat-0.9.apk`。

首页只有一台冰箱：门关着时，门上贴三张标签纸——**冰箱存货**、**能做啥**、**录入菜谱**；
点门开门，进内胆后**冷藏 / 冷冻**分两页，左右滑切换，每页 4 行 × 5 列、多的上下滚；
内胆下方是一条**调料区**架子，盐油酱醋葱姜蒜停在这儿，不占冷藏冷冻的格位；
**零食是一种分类，不是一个区**：冰激凌放冷冻、巧克力放冷藏，跟普通食材一样占格。

---

## 怎么打开

**安卓手机**：把 `what2eat-0.9.apk` 拷到手机上点开安装（第一次要允许「安装未知应用」），
或者连着电脑 `adb install -r what2eat-0.9.apk`。装完叫「我家冰箱」，图标是一台小冰箱。
完全离线，不申请网络权限，数据存在应用自己的存储里，卸载才清。

**电脑上预览**：双击 `start.bat`（Windows），会自动用浏览器打开 <http://127.0.0.1:5188/index.html>。
Gradle、Node、Python 都不需要，只要有 Python 或者直接双击 `index.html` 也能看。

- macOS / Linux / Git Bash：`./start.sh`
- 或者直接双击 `index.html`（走 `file://`，功能一样，只是部分浏览器对本地文件存储限制更严）

---

## 页面

| 页面 | 干什么 |
| --- | --- |
| **冰箱**（首页） | 一台立体冰箱，只有这一件事。关门时三张标签纸；开门后冷藏/冷冻两页（左右滑）、每页 4×5 格（上下滚），下方是调料区架子 |
| **存货** | 冰箱里所有东西的清单（全部 / 冷藏 / 冷冻 / 调料 四档筛选），搜索、看保质期、点条进编辑 |
| **食材库** | 内置 90 种 + 你自己加的。单选（可顺手填保质期、数量、放哪格）或多选批量放冰箱；调料自动进调料区，零食按冷藏 / 冷冻放 |
| **今天** | 今天 / 明天 / 任意日期 × 早餐 / 午餐 / 晚餐，点菜排餐；每顿自动检查食材缺口，一键进买菜单 |
| **汇总** | 本周三餐一览、库存构成、该先吃掉的临期食材、买菜清单、做饭记录 |
| **我的** | 常住人数、忌口（不吃辣 / 香菜 / 海鲜 / 牛羊 / 猪肉）、数据导出导入重置 |

外加两个工具页：**食材册**（68 道内置菜谱 + 你自己录的，可做 / 差点 / 全部）和**买菜单**。

### 首页这台冰箱怎么用

```
关门态  ──轻点门──▶  冷藏页 ⇄ 冷冻页    每页 4 行 × 5 列 = 20 格，多的上下滚
  │                  左右滑⇅            └─ 内胆下方：调料区（不占冷格）
  ├─ 标签纸「冰箱存货」 ──▶ 存货页
  ├─ 标签纸「能做啥」   ──▶ 食材册
  ├─ 标签纸「录入菜谱」 ──▶ 自己写一道菜，存进菜谱库
  └─ 底部「打开冰箱」/「放入食材」两个按钮
```

**默认是关着门的**：每次打开应用都从关门态开始，开门状态只活在当前这次会话里，不写进
localStorage —— 上次关页面时门开着，再进来也是关着的（`load()` 里强制复位，落盘时也会抹掉）。

**冷藏 / 冷冻怎么翻**：手指横向滑（桌面按住鼠标拖也行），顶部的「冷藏室 N / 冷冻室 N」
会跟着亮；点标签同样是翻页。

**调料区**：内胆最下面那条架子，标着数量，不占冷藏 / 冷冻的格位。
凡是 `data.js` 里 `cat: '调料'` 的（盐、糖、生抽、老抽、蚝油、料酒、醋、食用油、香油、淀粉、
豆瓣酱、干辣椒、花椒、胡椒、小葱、大葱、姜、大蒜……共 27 种）一律进**调料区**；
**零食只是分类，不是独立区域**：任何归到「零食」的东西（薯片、巧克力、冰激凌）都跟普通食材一样放进冷藏或冷冻，照样占格、照样算存量。冰淇淋 / 雪糕这类按名字自动进冷冻，巧克力 / 饼干默认冷藏，放进冰箱后随时能改。
零食不参与「能做几道」的判定——冰箱里只有一盒巧克力，不会因此推荐任何菜。
两者都**不占冷藏 / 冷冻的格位**，编辑面板里也不给选层位，直接标出它住哪儿。
冰箱里已有的调料老数据会在 `load()` 时自动迁到调料区，不用手动挪。

**编辑食材**：开门后点任意一格食材（或点架子上的一包），弹出面板——名称、图片（可传本地照片，
自动压成 160×160 的 JPEG 存进 localStorage）、数量步进、保质期（5 个快捷 chip 或手填日期）、
挪到冷藏 / 冷冻（调料固定调料区）、删除（二次确认）。保存后如果它其实是调料，架子会自动露出来，
不然保存完看不见它。

**放入食材**：底部「放入食材」→ 食材库。勾多选是一次性批量放（每样数量 1、层位按默认推断）；
点右侧「单个」是单选，可以把数量、保质期一次填好。如果冰箱里已经有同名食材，会弹确认框：
**合并**（数量相加、保质期取更早的那个）或**分开存**（各存一条，保质期互不影响）。

**食材库不够用？自己加**：食材库搜索框下面有一条虚线入口「自己加一个」，也可以在
「没找到某样东西」时点「把「xxx」加进来」——搜索词会直接带进面板。面板里填：

| 字段 | 说明 |
| --- | --- |
| 叫什么 | 存货、买菜单、菜谱匹配都用这个名字 |
| 算哪一类 | 蔬菜 / 肉蛋 / 水产 / 主食 / 豆乳 / 调料 / **零食** / 其他；按名字猜（孜然粉 → 调料、薯片 → 零食、油菜 → 蔬菜），也可以手动改 |
| 配个图标 | 55 个 emoji 挑一个（含冰淇淋、蛋糕等零食甜点），默认跟分类走、零食还会按名字猜（冰淇淋 → 🍦、巧克力 → 🍫、薯片 → 🍿）；嫌不够还能**自己画** |
| 单位 · 大概能放几天 | 只是默认值，放进冰箱后每一条还能单独改保质期 |

选「调料」会直接进调料区、不占冷格；选「零食」只定分类，放的时候照常进冷藏 / 冷冻（冰品自动进冷冻）。

底部两个出口：**先存进食材库**（存下并自动勾上，接着点「放进去」）或**放进冰箱**（一步到位）。
自己加的食材在列表里标着「我加的」，后面有「删掉」——只从食材库移除，冰箱里已经有的不受影响。
存在 `state.custom` 里（localStorage），换设备靠「我的 → 导出/导入」带走。

**录入自己的菜谱**：关门态门上第三张标签纸「录入菜谱」，或食材册右上角的「＋ 录一道」。
面板里照着内置菜谱的规格填，存进去就跟内置菜谱平起平坐——能搜到、能被推荐、能排进三餐、
缺料会进买菜单。

| 字段 | 怎么填 |
| --- | --- |
| 菜名 | 随便写，比如「外婆的红烧肉」 |
| 图标 | 35 个锅碗瓢盆挑一个，甜点冰品也在里面；也能自己画 |
| 分类 | 快手菜 / 家常菜 / 硬菜 / 汤羹 / 主食 / 早餐 / 凉菜（决定它出现在食材册哪一档） |
| 难度 · 用时 | 新手 / 熟练 / 挑战；10～60 分钟 |
| 食材 | 点「＋ 添加食材」从食材库（含你自定义的）里搜着选；每行填**用量**，右边的「主 / 辅」按钮切换主料还是配菜 |
| 做法 | 一行一步，空行自动忽略 |

**主料 vs 辅料**：主料参与「能不能做」的判定（冰箱里没有就算缺口），辅料不参与；
调料自动按家里常备算，跟内置菜谱一个规矩。所以自己录的菜，把真正撑起这道菜的食材标成「主」就行。

录完自动跳到食材册。自己录的菜在列表里带「我录的」标记，详情页底部有「改一改 / 删掉」
（删掉只从菜谱库移除，同时会把它从已经排好的三餐里摘掉，不会留下点不开的空白）。
存在 `state.recipes` 里，和库存一起落盘、一起导出。

**图标不够用？自己画**：编辑食材、自定义食材、录入菜谱这三个面板的图标区末尾都多了一格「✏️」。
点开是 16×16 的像素画布（每格约 18px，按住拖能连着画）：

- 点一下涂一格，**按住拖着涂**一片；11 个颜色 + 橡皮，涂错了「撤销」退一步、「清空」重来。
- 留白是透明的，不会被填成白底，所以放进冰箱格、存货列表里都跟 emoji 图标一样贴着背景。
- 「用这个图标」当场生效；再点一次「✏️」会把这张图**还原回格子**，接着改，不用重画。
- 存成 256×256 的 PNG（data URL，约 2 KB），跟照片一样写进 `state`，导出 / 导入一起带走。

备选 emoji 也顺手扩了：食材池 28 → **55** 个（🍦🍨🍧🍰🧁🍮🍩🍿🍌🍇🍓🍉🥭🥓🌰🥐🥖🥫🧃 …），
菜谱池 24 → **35** 个（冰品甜点 + 🍕🍔🍟🌮🍣）。

---

## 它是怎么"想"的

**食材优先（v0.2 重写）**：一道菜能不能做，只看「真食材」，调料和葱姜蒜一律不算数。

| 角色 | 例子 | 参与匹配 |
| --- | --- | --- |
| 真食材 | 番茄、鸡蛋、五花肉、香菇 | 算，缺了才算缺口 |
| 辅料 | 小葱、大葱、姜、大蒜、香菜 | 不算，按家里常备 |
| 调料 | 盐、生抽、醋、干辣椒、豆瓣酱 | 不算，缺了只提示不拦 |

所以：**冰箱里只有调料时，一道菜都不会推**，而是提示「先放两样食材」；
至少要有一道真食材对上，这道菜才会进入推荐（`anchored`），并按主料覆盖率排序。
「差一点就能开饭」= 只差 1 样真食材，且手头已经占了多数（≤2 样主料时占 1 样即可）。

**推荐排序**：`-缺口数 × 10 + 匹配率 × 6 + 用掉临期食材 × 4 + 快手加分`，
没有真食材兜底的菜直接沉底（-99）。

菜谱详情里每样料都标了「主料 / 辅料 / 调料 / 可选」，只给真主料打「有 / 缺」。

**闭环**：
```
冰箱有多少  →  能做什么菜  →  这顿差什么  →  买菜单  →  买回来一键入库  →  冰箱更新
```
买菜单里打勾「已买到」，点「放进冰箱」，库存数量就跟着涨，不用手工再录一遍。

**早餐**只推早餐 / 主食 / 快手清淡类，不会给你推红烧肉。

---

## 目录结构

```
What2Eat/
├─ index.html               # 唯一入口
├─ assets/
│  ├─ css/style.css         # 全部样式（米白 + 墨绿，宋体标题）
│  └─ js/
│     ├─ data.js            # 食材元数据（90 种）+ 菜谱库（68 道）
│     └─ app.js             # 存储、匹配算法、冰箱与各子页面、抽屉交互
├─ tools/shot.sh            # 无头 Chrome 截图（自测用）
├─ android/                 # 安卓工程（免 Gradle，脚本直出 APK）
│  ├─ build.sh              # aapt2 → javac → d8 → zipalign → apksigner 一条龙
│  ├─ make-icon.sh          # 用无头 Chrome 渲染 icon/*.html 出启动图标
│  ├─ java/…/MainActivity.java  # 极薄的 WebView 壳（含返回键、虚拟域名映射）
│  ├─ res/                  # 图标（含自适应图标）、主题、app 名
│  ├─ icon/*.html           # 图标矢量源，改了重跑 make-icon.sh
│  └─ assets/www/           # build.sh 从根目录同步进去的网页，别手改这里
├─ what2eat-0.9.apk         # 打好的安装包（自签，97 KB，构建产物不入库）
├─ .shots/test.html         # 冒烟测试（121 项，点真实按钮跑完整链路）
├─ .shots/test-seasoning.html # 食材优先规则测试（16 项：只有调料时不推荐）
├─ .shots/test-door.html     # 开门状态测试（7 项：默认关门 / 开门不落盘 / 重载仍关门）
├─ start.bat / start.sh     # 本地预览
└─ 1793603987845.jpg 等      # 设计参考图（本地留档，不入库）
```

仓库里刻意不放的东西（都在 `.gitignore` 里）：`android/.jre17/`（126 MB 的 JRE）、
`android/build/` 与 `android/assets/www/`（构建时自动生成）、`*.apk`、
签名密钥 `android/keystore/`、自测截图和需求参考图。

## 自测

```bash
# 起服务后
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --virtual-time-budget=9000 --dump-dom "http://127.0.0.1:5188/.shots/test.html" | grep pass=
# 同样的方法跑 .shots/test-seasoning.html（16 项）和 .shots/test-door.html（7 项）
```
当前 **121/121 + 16/16 + 7/7 通过**：首页只有冰箱、**默认关门且开门状态不跨会话**、开关门、冷藏默认、两页各占一屏宽、横向滑到冷冻后标签跟随、
每行 5 列 / 一屏 4 行 / 再多能上下滚、调料全在调料区且不占格位、调料编辑没有层位可选、
**零食是分类不是区域（冰淇淋自动进冷冻、巧克力进冷藏、照样占格、能改层位）**、
点食材编辑（改数量 / 挪层位 / 删除二次确认）、三张标签纸跳转、存货页 5 档筛选、食材库多选批量放、
同名合并与分开存、单放带保质期、调料入库自动进调料区、**自定义食材（猜分类 / 存库 / 直接放进冰箱 / 搜不到时一键加 / 删掉只影响食材库）**、
**录入菜谱（填名字 / 选食材 / 改用量 / 主辅切换 / 拆步骤 / 存库 / 能匹配能排餐 / 改一改 / 删掉连同计划清理 / 落盘）**、
**图标扩池 + 手绘像素图标（画 / 撤销 / 橡皮 / 存进库存 / 冰箱格与存货列表渲染）**、
点菜、缺口、买菜单入库、汇总、偏好、localStorage 落盘。

调试用 URL hash（不改代码就能跳到某个状态）：
```
index.html#view=fridge&door=0&zone=冷冻
index.html#view=fridge&door=1&mock=24        # 往冷藏塞 24 样假数据，看 4×5 的密度
index.html#view=fridge&door=1&zone=冷冻&snack=冰淇淋,巧克力  # 两包零食各归各的区
index.html#view=fridge&door=1&snack=薯片,巧克力      # 塞两包零食（薯片冷藏 / 冰淇淋冷冻）
index.html#view=stock&stockZone=调料
index.html#view=stock&sheet=edit:鸡蛋
index.html#view=catalog&catGroup=零食          # 食材库筛到零食分类
index.html#view=catalog&sheet=quick:南瓜
index.html#view=catalog&sheet=custom:秋葵     # 自定义食材面板，带好名字
index.html#view=catalog&cus=秋葵,马蹄         # 假装自己加过这几样，看列表标记
index.html#view=catalog&sheet=merge:鸡蛋
index.html#view=today&meal=晚餐&sheet=recipe:r01
index.html#view=fridge&door=0&sheet=newrecipe    # 直接打开录入菜谱面板
index.html#view=fridge&door=0&sheet=rfpick       # 直接进食材选择器
index.html#view=fridge&door=0&myr=红烧肉         # 假装录过一道自己的菜
index.html#view=recipes&sheet=myrecipe:红烧肉    # 打开自家菜谱详情（带改 / 删）
index.html#view=fridge&door=0&rfb=1              # 录入面板滚到底
index.html#view=fridge&door=1&sheet=edit:鸡蛋&pix=edit  # 直接打开手绘图标画布
```


---

## 已知限制 / 下一步

- 内置 68 道菜谱，加上你自己录的（`state.recipes`）。如果要接在线菜谱 API，结构已经留好
  （`allRecipes()` 是唯一的取用入口，往里加源就行）。
- 自己录菜谱还不支持「食材分组（腌料 / 浇汁）」和「配图」，只有图标；步骤是纯文本，没有配图位。
- 库存数量是手动加减，没有做「做一次菜自动按菜谱扣料」（数据结构支持，下一步加）。
- 保温/变温区、冰箱 3D 旋转还没做；食材图默认是 emoji + 色块（可以自己传照片，或在图标池末尾手绘一个像素图覆盖）。
- 「4 行 × 5 列」在 390×844 这类现代手机上正好一屏 20 格；矮屏（如 375×667）会自动少露一行，
  往下滑就有——格子数不变，只是可视区域小。
- 横向翻页靠 CSS `scroll-snap-type: x`，竖向看更多靠内层 `overflow-y`。无头浏览器不派发触摸手势，
  自动化测试是直接改 `scrollLeft` 验证「翻页后标签跟随」；**手感仍需在真机 / 真实浏览器上过一遍**。
- APK 是**自签名调试包**（密钥 `android/keystore/what2eat.jks`，口令 `what2eat`）。直接装没问题，
  但要上应用商店得换正式签名。包名 `com.what2eat.app` 固定、签名不变，以后覆盖安装不会丢数据。
- 在 **x86_64 模拟器**上退出应用时，logcat 里会留一条 `SIGILL` 的 tombstone：堆栈是
  `ComponentCallbacksController.dispatchTrimMemory → WebView.onTrimMemory → libwebviewchromium.so`，
  fault addr 每次都是同一个地址（典型的「CPU 不认识这条指令」）。这是模拟器 CPU 模型缺指令集导致的，
  跟应用代码无关，发生在进程退出瞬间，界面无感；arm64 真机不会有。拦 `onTrimMemory` 没用
  （WebView 同时注册在 Application 上），杀进程也来不及（trim 在 `onDestroy` 之前就发了），所以就这样放着。


---

## 打成安卓包

```bash
cd android
./make-icon.sh      # 只在改了图标时需要
./build.sh          # 出 build/what2eat-0.9.apk
```

不需要 Gradle，也不拉任何依赖，五步走完：

| 步骤 | 工具 | 干什么 |
| --- | --- | --- |
| 1 | 脚本 | 把根目录 `index.html + assets/` 同步到 `assets/www/` |
| 2 | `aapt2` | 编译 `res/`、链接 manifest、把 `assets/` 一起打进包 |
| 3 | `javac` | 编译 `MainActivity.java`（整个工程就这一个类） |
| 4 | `d8` | class → `classes.dex`，塞回 APK |
| 5 | `zipalign` + `apksigner` | 4 字节对齐 + 签名（首次自动生成 keystore） |

**环境要求**（Windows / Linux / macOS 都行，脚本自己认平台，不用改代码）：

| 要什么 | 用途 |
| --- | --- |
| Android SDK | `build-tools`（aapt2、zipalign、lib/d8.jar、lib/apksigner.jar）+ `platforms/android-34`；路径用 `ANDROID_HOME` 指过去 |
| JDK 11+ | `javac` 编 Java，`java` 跑 d8 / apksigner |
| `python3` 或 `zip` | 把 `classes.dex` 塞进 APK |

脚本找东西的顺序：`ANDROID_HOME` / `ANDROID_SDK_ROOT` → **本目录下的 `.sdk`** → 各平台默认目录
（`~/Android/Sdk`、`~/Library/Android/sdk`、`%LOCALAPPDATA%\Android\Sdk`、`/opt/android-sdk`）；
JDK 先看 `JAVA_HOME`、`PATH`，再扫 **`.jdk/`**、`.jre17/`、`/usr/lib/jvm`、`/Library/Java/JavaVirtualMachines`、
`C:\Program Files\Java` 等常见位置，取版本最高的。
`javac` 是 8 就用 `-source 1.8 -bootclasspath`，是 9+ 就自动切到 `--release 8 -classpath`。

只有 JDK 8 的老机器也能用：`d8` / `apksigner` 是 class 55 的，必须 Java 11+ 来跑，
所以脚本会优先用 `.jdk/` / `android/.jre17/` 里的新版 Java 执行它们，`javac` 仍用系统那个。

**在没有 Android Studio 的 Linux 上（比如 NAS）**：

```bash
cd android
sh setup-sdk.sh     # 下 build-tools + platform + 一个 JDK 17，装进 android/.sdk、android/.jdk
sh build.sh         # 出 build/what2eat-0.9.apk
```

`setup-sdk.sh` 走的是「直接下两个官方 zip 解压」这条路，绕开了 `sdkmanager` 的三个麻烦：
它自己就得 JDK 17 才能启动、要交互同意 licenses、只认 `dl.google.com` 一个源。
默认源是 `dl.google.com`，不通就自动退到腾讯云镜像；也可以自己指定：

```bash
W2E_SDK_MIRROR=https://你的镜像/android/repository sh setup-sdk.sh
sh setup-sdk.sh --sdk-only   # 机器上已经有 JDK 11+，只补 SDK
sh setup-sdk.sh --force      # 删掉重下
```

装完就是这样两个目录（都在 `.gitignore` 里，不入库，约 400 MB）：

```
android/.sdk/build-tools/34.0.0/{aapt2, zipalign, lib/d8.jar, lib/apksigner.jar}
android/.sdk/platforms/android-34/android.jar
android/.jdk/jdk-17.0.x+y/
```

`build.sh` 会自动用它们，**不用 export 任何变量**。不想留了 `rm -rf .sdk .jdk` 即可。

如果你更习惯系统级安装（机器上本来就有 `sdkmanager`），原路子也还能走：

```bash
export ANDROID_HOME=$HOME/android-sdk
yes | sdkmanager --licenses >/dev/null
sdkmanager "build-tools;34.0.0" "platforms;android-34"
```

> 注意 `platforms;android-34` 在 Google 仓库里的实际文件名是 `platform-34-ext7_r03.zip`
> （`platform-34_r03.zip` 是 404），手动下载的话别下错。

脚本是 POSIX 兼容的，`sh build.sh` / `bash build.sh` 都能跑（Debian 上 `sh` 是 dash，
没在这里面用 bash 专有语法）。

产物在 `android/build/what2eat-0.9.apk`，**不入库**（`.gitignore` 里有 `*.apk`）。
想换个 build-tools 版本，`BT_VERSION=35.0.0 ./build.sh` 即可。

**壳为什么这么写**（`android/java/…/MainActivity.java`）：

- **不直接用 `file://` 加载页面**：把 `https://w2e.local` 当虚拟域名，在 `shouldInterceptRequest` 里
  从 assets 读文件返回。因为 `file://` 下各家 WebView 对 localStorage 的支持不一致，
  而这个应用的全部数据都在 localStorage 里，丢了就等于全没了。
- `setTextZoom(100)`：跟系统字体大小脱钩，否则用户把字体调大，手机画布会被撑破。
- 拦截器一律回 `no-store`：升级后不会吃到旧缓存。
- 返回键分三层：先问页面有没有打开的抽屉 / 弹窗（有就关掉，靠注入的一小段 JS），
  再看 WebView 能不能后退，最后才是「再按一次退出」。
- `onPause` 里补一发 `pagehide`，把前端 60ms 防抖里还没落盘的状态立刻写进去。
- 不申请任何权限（连 `INTERNET` 都没有），装的时候不会弹权限列表。
- 开屏页背景和图标底垫都是米色 / 墨绿，跟页面同色，启动不会闪一下白。

**换图标**：改 `android/icon/app-icon.html`（老系统用的方形图标）和 `app-icon-fg.html`
（自适应图标前景，透明底），重跑 `make-icon.sh`。前景主体要缩进中间 66%，
不然圆形遮罩会把边切掉。

**版本号**：`android/build.sh` 顶部的 `VER_CODE` / `VER_NAME`。
