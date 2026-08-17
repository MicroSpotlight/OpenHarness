const copy = {
  zh: {
    skip: "跳到主要内容",
    navLabel: "主导航",
    mobileNavLabel: "移动端导航",
    openMenu: "打开菜单",
    closeMenu: "关闭菜单",
    navExperience: "桌面体验",
    navCapabilities: "能力",
    navHow: "运行方式",
    navFaq: "常见问题",
    heroEyebrow: "跨平台原生 AI Agent 桌面应用",
    heroTitleTop: "OpenHarness",
    heroTitleBottom: "让 Harness 跨平台原生运行。",
    heroLede: "无需单独安装 Node.js 或输入启动命令。打开原生窗口，直接进入完整、可组合、可追溯的 Agent 工作空间。",
    heroDownloadCta: "前往下载",
    downloadKicker: "下载",
    downloadTitle: "选择适合这台设备的安装包。",
    downloadBody: "安装包已包含运行环境，无需另外安装 Node.js。页面会优先标出当前设备对应的版本。",
    downloadGroupLabel: "按平台选择安装包",
    windowsSupport: "Windows 10 / 11 · x64 / ARM64",
    linuxSupport: "Ubuntu 22.04+ / Debian 12+ · x64 / ARM64",
    macSupport: "macOS 15+ · Apple Silicon / Intel",
    packageLabel: "安装程序",
    portablePackageLabel: "便携应用",
    diskImageLabel: "磁盘映像",
    linuxDebDownload: "需要 .deb 或 .rpm？查看全部发布文件",
    downloadAppleSilicon: "Apple Silicon",
    downloadIntel: "Intel",
    downloadWindows: "x64",
    downloadWindowsArm: "ARM64",
    downloadLinux: "x64",
    downloadLinuxArm: "ARM64",
    productStageLabel: "OpenHarness 应用界面",
    sessionScreenshotAlt: "OpenHarness 中运行 Agent 任务的会话界面",
    heroCaption: "OpenHarness 原生窗口中的 DeepSeek Harness Web UI",
    factsLabel: "产品概览",
    factLaunch: "一次点击启动",
    factLaunchValue: "无需手动运行命令",
    factLocal: "本地运行",
    factLocalValue: "无需单独部署",
    factShared: "配置延续",
    factSharedValue: "沿用已有设置",
    factHarness: "完整 Harness",
    factHarnessValue: "插件能力保持不变",
    experienceKicker: "完整 Harness 体验",
    experienceTitle: "桌面宿主，不是另一套生态。",
    experienceBody: "OpenHarness 将 DeepSeek Harness（DSH）完整装进跨平台桌面应用。模型、工具、技能、会话与插件保持一致，只是使用入口从命令行变成桌面窗口。",
    learnHarness: "DeepSeek Harness 官方网站",
    experienceOneTitle: "开箱即用",
    experienceOneBody: "DeepSeek Harness 与运行环境随 App 提供，无需另外安装 Node.js 或输入启动命令。",
    experienceTwoTitle: "原生桌面体验",
    experienceTwoBody: "从桌面打开窗口，关闭后继续驻留系统托盘，需要时随时回到工作区。",
    experienceThreeTitle: "延续已有工作区",
    experienceThreeBody: "如果已经使用 DSH，现有模型配置、会话和插件可以继续使用，无需重新开始。",
    capabilitiesKicker: "完整的 Harness 能力",
    capabilitiesTitle: "一个入口，组合完整工作流。",
    capabilitiesBody: "OpenHarness 不改变 DeepSeek Harness 的能力，而是让模型、工具、技能、会话和执行环境在桌面入口中继续组合。",
    capModelTitle: "模型",
    capModelBody: "选择、替换或扩展模型接入。",
    capToolsTitle: "工具与技能",
    capToolsBody: "让 Agent 理解环境并执行真实任务。",
    capSessionsTitle: "会话",
    capSessionsBody: "恢复、分叉、搜索与重放同一事件流。",
    capSandboxTitle: "沙箱",
    capSandboxBody: "为不同任务组合可控执行环境。",
    capStorageTitle: "存储",
    capStorageBody: "保留工作状态与长期上下文。",
    capSchedulingTitle: "循环与调度",
    capSchedulingBody: "支持持续运行与多阶段 Agent 工作流。",
    howKicker: "从下载到第一个任务",
    howTitle: "打开 App，直接开始使用。",
    howBody: "OpenHarness 已经把 DeepSeek Harness（DSH）的 Web UI 和运行环境装进 App，你只需要完成模型与工作区设置。",
    flowOneTitle: "下载并打开",
    flowOneBody: "选择当前系统和架构对应的安装包，完成安装后直接打开 OpenHarness。",
    flowTwoTitle: "配置模型",
    flowTwoBody: "在“设置 → 模型”中填写 DeepSeek API Key，也可以继续使用已有的模型配置。",
    flowThreeTitle: "选择工作区",
    flowThreeBody: "添加需要处理的项目文件夹，新建会话并描述任务，后续工作都在窗口中完成。",
    sourceKicker: "开放、透明、可验证",
    sourceTitle: "建立在开源之上。",
    sourceBody: "OpenHarness 原创代码采用 Apache License 2.0；内置的 DeepSeek Harness 组件单独采用 MIT License。为避免品牌混淆，OpenHarness 使用独立的名称、图标、Bundle ID 和视觉主题。",
    deepSeekHarnessRepo: "DeepSeek Harness 官方 GitHub",
    desktopRepo: "OpenHarness 仓库",
    faqKicker: "常见问题",
    faqTitle: "下载之前，你可能想知道。",
    faqOneQuestion: "这是 DeepSeek Harness 官方应用吗？",
    faqOneAnswer: "不是。OpenHarness 由 MicroSpotlight 独立开发，使用独立的产品名称、图标、Bundle ID 和视觉主题，不暗示 DeepSeek 的认可或隶属关系。",
    faqTwoQuestion: "OpenHarness 会把数据上传到自己的服务器吗？",
    faqTwoAnswer: "OpenHarness 不提供独立云服务，也不会把数据上传到我们的服务器。模型供应商和插件可能有各自的数据处理方式，请以实际配置为准。",
    faqThreeQuestion: "会覆盖现有的命令行配置吗？",
    faqThreeAnswer: "不会创建另一套配置目录。OpenHarness 复用 ~/.dsh，因此已有模型凭据、会话与插件可继续使用。",
    faqFourQuestion: "目前支持哪些平台？",
    faqFourAnswer: "OpenHarness 支持 macOS 15.0+、Windows 10+ x64/ARM64，以及 Ubuntu 22.04+、Debian 12+ 等 x64/ARM64 Linux 发行版；Linux 需要 glibc 2.35+ 和 WebKitGTK 4.1。",
    faqFiveQuestion: "如何选择下载架构？",
    faqFiveAnswer: "按设备架构选择 x64 或 ARM64：macOS 使用 DMG，Windows 使用 EXE，Linux 可选择 AppImage、Debian 或 RPM 包。",
    ctaKicker: "准备开始",
    ctaTitle: "让下一次 Harness 运行，从桌面开始。",
    ctaDownloadCta: "选择安装包",
    deepSeekHarnessWebsite: "DeepSeek Harness 官方网站",
    license: "许可证",
    footerNote: "OpenHarness 由 MicroSpotlight 独立开发。为避免与 DeepSeek 品牌混淆，项目使用独立的产品名称、图标、Bundle ID 和视觉主题，不暗示获得 DeepSeek 认可或与 DeepSeek 存在隶属关系。",
  },
  en: {
    skip: "Skip to main content",
    navLabel: "Primary navigation",
    mobileNavLabel: "Mobile navigation",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    navExperience: "Desktop experience",
    navCapabilities: "Capabilities",
    navHow: "How it works",
    navFaq: "FAQ",
    heroEyebrow: "Native cross-platform AI agent desktop app",
    heroTitleTop: "OpenHarness",
    heroTitleBottom: "Harness, native on your desktop.",
    heroLede: "Skip the separate Node.js setup and launch commands. Open a native window and step into a complete, composable, traceable agent workspace.",
    heroDownloadCta: "Go to downloads",
    downloadKicker: "Download",
    downloadTitle: "Choose the right build for this device.",
    downloadBody: "Every installer includes the runtime, so Node.js is not required. The best match for this device is highlighted automatically.",
    downloadGroupLabel: "Choose an installer by platform",
    windowsSupport: "Windows 10 / 11 · x64 / ARM64",
    linuxSupport: "Ubuntu 22.04+ / Debian 12+ · x64 / ARM64",
    macSupport: "macOS 15+ · Apple Silicon / Intel",
    packageLabel: "Installer",
    portablePackageLabel: "Portable app",
    diskImageLabel: "Disk image",
    linuxDebDownload: "Need a .deb or .rpm? View all release files",
    downloadAppleSilicon: "Apple Silicon",
    downloadIntel: "Intel",
    downloadWindows: "x64",
    downloadWindowsArm: "ARM64",
    downloadLinux: "x64",
    downloadLinuxArm: "ARM64",
    productStageLabel: "OpenHarness application window",
    sessionScreenshotAlt: "An Agent task session running in OpenHarness",
    heroCaption: "The DeepSeek Harness Web UI inside a native OpenHarness window",
    factsLabel: "Product overview",
    factLaunch: "One-click launch",
    factLaunchValue: "No command required",
    factLocal: "Local runtime",
    factLocalValue: "No separate deployment",
    factShared: "Shared configuration",
    factSharedValue: "Keep existing settings",
    factHarness: "Complete Harness",
    factHarnessValue: "Every plugin capability intact",
    experienceKicker: "The complete Harness experience",
    experienceTitle: "A desktop host, not another ecosystem.",
    experienceBody: "OpenHarness packages the complete DeepSeek Harness (DSH) experience as a native desktop app for macOS, Windows, and Linux. Models, tools, skills, sessions, and plugins stay the same; the entry point moves from the command line to a desktop window.",
    learnHarness: "DeepSeek Harness official website",
    experienceOneTitle: "Ready out of the box",
    experienceOneBody: "DeepSeek Harness and its runtime ship with the app, with no separate Node.js installation or launch commands.",
    experienceTwoTitle: "Native desktop experience",
    experienceTwoBody: "Open it from the desktop, close it to the system tray, and return to your workspace whenever you need it.",
    experienceThreeTitle: "Your workspace continues",
    experienceThreeBody: "If you already use DSH, your model settings, sessions, and plugins remain available without starting over.",
    capabilitiesKicker: "Complete Harness capabilities",
    capabilitiesTitle: "One entry point for complete workflows.",
    capabilitiesBody: "OpenHarness preserves the capabilities of DeepSeek Harness while bringing models, tools, skills, sessions, and execution environments into a desktop entry point.",
    capModelTitle: "Models",
    capModelBody: "Select, swap, or extend model integrations.",
    capToolsTitle: "Tools and skills",
    capToolsBody: "Help agents understand environments and do real work.",
    capSessionsTitle: "Sessions",
    capSessionsBody: "Resume, fork, search, and replay one event stream.",
    capSandboxTitle: "Sandboxes",
    capSandboxBody: "Compose controlled execution environments for each task.",
    capStorageTitle: "Storage",
    capStorageBody: "Keep working state and long-term context.",
    capSchedulingTitle: "Loops and scheduling",
    capSchedulingBody: "Support persistent and multi-stage agent workflows.",
    howKicker: "From download to first task",
    howTitle: "Open the app and start working.",
    howBody: "OpenHarness packages the DeepSeek Harness (DSH) Web UI and runtime in the app, leaving only model and workspace setup.",
    flowOneTitle: "Download and open",
    flowOneBody: "Choose the package for your operating system and architecture, finish installation, and open OpenHarness.",
    flowTwoTitle: "Configure a model",
    flowTwoBody: "Enter your DeepSeek API key under Settings → Models, or continue with an existing model configuration.",
    flowThreeTitle: "Choose a workspace",
    flowThreeBody: "Add the project folder you want to work with, start a session, and describe the task.",
    sourceKicker: "Open, transparent, verifiable",
    sourceTitle: "Built on open source.",
    sourceBody: "Original OpenHarness code is licensed under Apache License 2.0; the bundled DeepSeek Harness component is separately licensed under the MIT License. OpenHarness uses its own name, icon, Bundle ID, and visual theme to avoid brand confusion.",
    deepSeekHarnessRepo: "DeepSeek Harness official GitHub",
    desktopRepo: "OpenHarness repo",
    faqKicker: "Frequently asked questions",
    faqTitle: "A few things to know before you download.",
    faqOneQuestion: "Is this an official DeepSeek Harness app?",
    faqOneAnswer: "No. OpenHarness is independently developed by MicroSpotlight and uses its own product name, icon, Bundle ID, and visual theme. It does not imply endorsement by or affiliation with DeepSeek.",
    faqTwoQuestion: "Does OpenHarness upload data to its own server?",
    faqTwoAnswer: "OpenHarness provides no separate cloud service and does not upload data to our servers. Model providers and plugins may have their own data practices.",
    faqThreeQuestion: "Will it overwrite my CLI configuration?",
    faqThreeAnswer: "It does not create a second configuration directory. OpenHarness reuses ~/.dsh, so your existing credentials, sessions, and plugins remain available.",
    faqFourQuestion: "Which platforms are supported?",
    faqFourAnswer: "OpenHarness supports macOS 15.0+, Windows 10+ on x64/ARM64, and x64/ARM64 Linux distributions such as Ubuntu 22.04+ and Debian 12+; Linux requires glibc 2.35+ and WebKitGTK 4.1.",
    faqFiveQuestion: "Which download architecture should I choose?",
    faqFiveAnswer: "Choose x64 or ARM64 for your device: DMG on macOS, EXE on Windows, or AppImage, Debian, and RPM packages on Linux.",
    ctaKicker: "Ready when you are",
    ctaTitle: "Start your next Harness run from the desktop.",
    ctaDownloadCta: "Choose a download",
    deepSeekHarnessWebsite: "DeepSeek Harness official website",
    license: "License",
    footerNote: "OpenHarness is independently developed by MicroSpotlight. It uses its own product name, icon, Bundle ID, and visual theme to avoid confusion with the DeepSeek brand and does not imply endorsement or affiliation.",
  },
};

const languageButton = document.querySelector("[data-language]");
const menuButton = document.querySelector("[data-menu-button]");
const mobileMenu = document.querySelector("[data-mobile-menu]");
const header = document.querySelector("[data-header]");
let activeLanguage = localStorage.getItem("openharness-language") === "en" ? "en" : "zh";
let latestRelease;

function formatFileSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function downloadPlatformFor(platform, architecture) {
  platform = `${platform}`.toLowerCase();
  architecture = `${architecture}`.toLowerCase();
  const isArm = /\b(?:arm|arm64|aarch64)\b/.test(architecture);
  const isX64 = /\b(?:amd64|x64|x86|x86_64)\b/.test(architecture);
  if (platform.includes("win")) return isArm ? "windows-aarch64" : "windows-x86_64";
  if (platform.includes("linux") && !platform.includes("android")) {
    return isArm ? "linux-aarch64" : "linux-x86_64";
  }
  if (platform.includes("mac")) return isArm || !isX64 ? "darwin-aarch64" : "darwin-x86_64";
  return null;
}

async function preferredDownloadPlatform() {
  const platform = `${navigator.userAgentData?.platform ?? navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  let architecture = `${navigator.userAgentData?.architecture ?? ""} ${platform}`.toLowerCase();
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      const hints = await navigator.userAgentData.getHighEntropyValues(["architecture", "bitness"]);
      architecture = `${hints.architecture ?? ""} ${hints.bitness ?? ""} ${architecture}`.toLowerCase();
    } catch {
      // Fall back to the low-entropy platform and user-agent values.
    }
  }
  return downloadPlatformFor(platform, architecture);
}

async function prioritizeDownloadGroups() {
  const preferredPlatform = await preferredDownloadPlatform();
  document.querySelectorAll("[data-download-group]").forEach((group) => {
    const links = [...group.querySelectorAll("[data-download-platform]")];
    const preferred = links.find((link) => link.dataset.downloadPlatform === preferredPlatform);
    const secondaryClass = group.dataset.secondaryClass;
    links.forEach((link) => {
      link.classList.remove("button-primary", "button-secondary", "button-ghost-light");
      link.classList.add(link === preferred ? "button-primary" : secondaryClass);
    });
    if (preferred) group.prepend(preferred);
  });
}

function renderLatestRelease() {
  const releaseVersion = latestRelease?.version;
  const downloads = latestRelease?.downloads ?? latestRelease?.platforms ?? {};
  const platformLabels = {
    "darwin-aarch64": "macOS arm64",
    "darwin-x86_64": "macOS x64",
    "windows-aarch64": "Windows ARM64",
    "windows-x86_64": "Windows x64",
    "linux-aarch64": "Linux ARM64",
    "linux-x86_64": "Linux x64",
  };

  document.querySelectorAll("[data-download-platform]").forEach((link) => {
    const platform = link.dataset.downloadPlatform;
    const installer = downloads[platform];
    if (!installer?.url || !installer?.name || !installer?.size) return;

    link.href = installer.url;
    link.title = `${platformLabels[platform]} · ${installer.name} · ${formatFileSize(installer.size)}`;
  });

  const versionSummary = releaseVersion
    ? `${releaseVersion.startsWith("v") ? releaseVersion : `v${releaseVersion}`} · `
    : "";
  document.querySelectorAll("[data-release-summary]").forEach((summary) => {
    summary.textContent = `${versionSummary}macOS 15+ · Windows 10+ · Linux x64/ARM64`;
  });
}

async function loadLatestRelease() {
  try {
    const response = await fetch("latest.json", { cache: "no-cache" });
    if (!response.ok) return;

    const release = await response.json();
    if (!release?.version || (!release?.downloads && !release?.platforms)) return;
    latestRelease = release;
    renderLatestRelease();
  } catch {
    // Keep the GitHub Releases fallback links when metadata is unavailable.
  }
}

function translate(language) {
  activeLanguage = language;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const value = copy[language][element.dataset.i18n];
    if (value) element.textContent = value;
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    const value = copy[language][element.dataset.i18nAria];
    if (value) element.setAttribute("aria-label", value);
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    const value = copy[language][element.dataset.i18nAlt];
    if (value) element.setAttribute("alt", value);
  });

  languageButton.setAttribute(
    "aria-label",
    language === "zh" ? "Switch to English" : "切换到中文",
  );
  localStorage.setItem("openharness-language", language);
  renderLatestRelease();
}

function closeMenu() {
  mobileMenu.classList.remove("open");
  document.body.classList.remove("menu-open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", copy[activeLanguage].openMenu);
  menuButton.innerHTML = '<i data-lucide="menu" aria-hidden="true"></i>';
  if (window.lucide) window.lucide.createIcons();
}

languageButton.addEventListener("click", () => {
  translate(activeLanguage === "zh" ? "en" : "zh");
});

menuButton.addEventListener("click", () => {
  const isOpening = !mobileMenu.classList.contains("open");
  mobileMenu.classList.toggle("open", isOpening);
  document.body.classList.toggle("menu-open", isOpening);
  menuButton.setAttribute("aria-expanded", String(isOpening));
  menuButton.setAttribute(
    "aria-label",
    isOpening ? copy[activeLanguage].closeMenu : copy[activeLanguage].openMenu,
  );
  menuButton.innerHTML = `<i data-lucide="${isOpening ? "x" : "menu"}" aria-hidden="true"></i>`;
  if (window.lucide) window.lucide.createIcons();
});

mobileMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

window.addEventListener("resize", () => {
  if (window.innerWidth > 980 && mobileMenu.classList.contains("open")) closeMenu();
});

window.addEventListener(
  "scroll",
  () => header.classList.toggle("scrolled", window.scrollY > 12),
  { passive: true },
);

document.querySelector("[data-year]").textContent = new Date().getFullYear();
prioritizeDownloadGroups();
translate(activeLanguage);
loadLatestRelease();

window.addEventListener("load", () => {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
});
