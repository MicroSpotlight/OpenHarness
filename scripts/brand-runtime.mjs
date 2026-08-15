#!/usr/bin/env node

import {
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = resolve(
  projectRoot,
  "src-tauri/runtime/dsh/node_modules/@deepseek-ai",
);
const frontendDist = resolve(packagesRoot, "dsh-web-frontend/dist");

function read(relativePath) {
  return readFileSync(resolve(packagesRoot, relativePath), "utf8");
}

function write(relativePath, content) {
  writeFileSync(resolve(packagesRoot, relativePath), content);
}

function replaceOnce(content, search, replacement, label) {
  if (content.includes(replacement)) return content;
  const first = content.indexOf(search);
  if (first < 0 || content.indexOf(search, first + search.length) >= 0) {
    throw new Error(`OpenHarness runtime branding: expected one ${label}`);
  }
  return content.slice(0, first) + replacement + content.slice(first + search.length);
}

function replaceSection(content, start, end, replacement, label) {
  if (content.includes(replacement)) return content;
  const startIndex = content.indexOf(start);
  const endIndex = content.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`OpenHarness runtime branding: missing ${label} section`);
  }
  return content.slice(0, startIndex) + replacement + content.slice(endIndex);
}

const fishLogoSection = `//#region lib/types/FishLogo.js
/** Render the OpenHarness app mark. */
function FishLogo({ size = 24, className }) {
	return jsx("img", {
		src: "/openharness-icon.png",
		width: size,
		height: size,
		className,
		alt: "",
		"aria-hidden": "true",
		style: {
			borderRadius: Math.max(3, size * .2),
			objectFit: "cover"
		}
	});
}
//#endregion
`;

const wordmarkSection = `//#region lib/types/BrandWordmark.js
/** Render the OpenHarness app mark and product name. */
function BrandWordmark({ size = 24, className }) {
	return jsxs("span", {
		className,
		"aria-label": "OpenHarness",
		style: {
			display: "inline-flex",
			alignItems: "center",
			gap: 8,
			height: size,
			color: "currentColor",
			fontSize: Math.max(14, size * .72),
			fontWeight: 650,
			whiteSpace: "nowrap"
		},
		children: [
			jsx("img", {
				src: "/openharness-icon.png",
				width: size,
				height: size,
				alt: "",
				"aria-hidden": "true",
				style: {
					borderRadius: Math.max(3, size * .2),
					objectFit: "cover"
				}
			}),
			jsx("span", { children: "OpenHarness" })
		]
	});
}
//#endregion
`;

const openHarnessTheme = `    <meta name="theme-color" content="#0f1115" />
    <style id="openharness-theme">
      :root {
        --dsw-static-deepseek-50: #fff1ee;
        --dsw-static-deepseek-100: #ffe0d9;
        --dsw-static-deepseek-200: #ffc1b6;
        --dsw-static-deepseek-300: #ff9484;
        --dsw-static-deepseek-400: #ef5b49;
        --dsw-static-deepseek-450: #e64d3c;
        --dsw-static-deepseek-500: #d23b2d;
        --dsw-static-deepseek-600: #b72d22;
        --dsw-static-deepseek-700: #93251d;
        --dsw-static-deepseek-800: #72211c;
        --dsw-static-deepseek-900: #481815;
      }
    </style>`;

let primitives = read("dsh-client-ui-primitives/lib/index.js");
primitives = replaceSection(
  primitives,
  "//#region lib/types/FishLogo.js",
  "//#region lib/types/BrandWordmark.js",
  fishLogoSection,
  "FishLogo",
);
primitives = replaceSection(
  primitives,
  "//#region lib/types/BrandWordmark.js",
  "//#region \\0dsh-css-stub:./Tooltip.module.css.mjs",
  wordmarkSection,
  "BrandWordmark",
);
write("dsh-client-ui-primitives/lib/index.js", primitives);

const upstreamChineseWelcome = "DeepSeek Harness 目前的 0.1 版本仍处在面向 Harness 开发者进行测试的阶段，还有许多地方需要持续改进和打磨，希望听取广大开发者的反馈建议。预计 DeepSeek Harness 的核心插件以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\\n\\n我们期待与全球开发者一起，在开源、开放、可复用、可组合的基础设施之上，共同探索智能上限。欢迎全球 Harness 开发者加入 DSH 插件生态。";
const previousChineseWelcome = "OpenHarness 0.1 当前为预发布版本，功能和交互仍在持续完善，欢迎开发者反馈问题和建议。\\n\\nOpenHarness 是独立的桌面应用，基于 MIT 许可的 DeepSeek Harness 开源运行时构建。";
const openHarnessChineseWelcome = "OpenHarness 是由 MicroSpotlight 独立开发的桌面应用。内置的 DeepSeek Harness 上游运行时组件单独采用 MIT License；OpenHarness 原创代码采用 Apache License 2.0。";
const upstreamEnglishWelcome = "DeepSeek Harness 0.1 remains in testing for Harness developers. Many areas need further improvement, and we welcome feedback from the developer community. DeepSeek Harness's core plugins and foundational APIs will continue to evolve rapidly over the coming months.\\n\\nWe look forward to exploring the limits of intelligence with developers around the world, building on open-source, open, reusable, and composable infrastructure. We welcome Harness developers everywhere to join the DSH plugin ecosystem.";
const previousEnglishWelcome = "OpenHarness 0.1 is a prerelease. Features and interactions are still evolving, and developer feedback is welcome.\\n\\nOpenHarness is an independent desktop app built on the MIT-licensed DeepSeek Harness open-source runtime.";
const openHarnessEnglishWelcome = "OpenHarness is an independent desktop app developed by MicroSpotlight. Its bundled DeepSeek Harness upstream runtime is separately licensed under MIT; OpenHarness original code is licensed under Apache License 2.0.";

let settings = read("dsh-client-ui-settings-models/lib/client.js");
settings = settings.replace(previousChineseWelcome, upstreamChineseWelcome);
settings = replaceOnce(
  settings,
  upstreamChineseWelcome,
  openHarnessChineseWelcome,
  "Chinese welcome notice",
);
settings = settings.replace(previousEnglishWelcome, upstreamEnglishWelcome);
settings = replaceOnce(
  settings,
  upstreamEnglishWelcome,
  openHarnessEnglishWelcome,
  "English welcome notice",
);
write("dsh-client-ui-settings-models/lib/client.js", settings);

let connection = read("dsh-client-connection/lib/client.js");
connection = connection.replaceAll("DeepSeek Harness", "OpenHarness");
write("dsh-client-connection/lib/client.js", connection);

let webApp = read("dsh-web-app/lib/index.js");
webApp = webApp.replaceAll(
  "DeepSeek Harness Web GUI",
  "desktop interface provided by OpenHarness",
);
write("dsh-web-app/lib/index.js", webApp);

let webStartup = read("dsh-web-app/lib/startup.js");
webStartup = webStartup.replaceAll(
  "Serve the DeepSeek Harness browser UI.",
  "Serve the OpenHarness interface.",
);
write("dsh-web-app/lib/startup.js", webStartup);

let staticHost = read("dsh-host-frontend-static/lib/index.js");
staticHost = replaceOnce(
  staticHost,
  '\t".map": "application/json",\n\t".webmanifest": "application/manifest+json"',
  '\t".map": "application/json",\n\t".png": "image/png",\n\t".webmanifest": "application/manifest+json"',
  "PNG MIME type",
);
write("dsh-host-frontend-static/lib/index.js", staticHost);

let cordisPreset = read("dsh/config/agent-presets/cordis/agent.cordis.yml");
cordisPreset = replaceOnce(
  cordisPreset,
  "running on the DeepSeek Harness.",
  "running in OpenHarness on the DeepSeek Harness runtime.",
  "Cordis preset product identity",
);
write("dsh/config/agent-presets/cordis/agent.cordis.yml", cordisPreset);

const indexPath = resolve(frontendDist, "index.html");
let indexHtml = readFileSync(indexPath, "utf8");
indexHtml = indexHtml.replace('<html lang="zh-CN">', '<html lang="en">');
indexHtml = indexHtml.replace(
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
  '<link rel="icon" type="image/png" href="/openharness-icon.png" />',
);
indexHtml = indexHtml.replace("<title>DeepSeek Harness</title>", "<title>OpenHarness</title>");
indexHtml = replaceOnce(
  indexHtml,
  "  </head>",
  `${openHarnessTheme}\n  </head>`,
  "HTML theme",
);
writeFileSync(indexPath, indexHtml);

const manifestPath = resolve(frontendDist, "manifest.webmanifest");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.name = "OpenHarness";
manifest.short_name = "OpenHarness";
manifest.theme_color = "#0f1115";
manifest.background_color = "#f9fafb";
manifest.icons = [
  {
    src: "/openharness-icon.png",
    sizes: "1254x1254",
    type: "image/png",
    purpose: "any",
  },
];
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

copyFileSync(
  resolve(projectRoot, "assets/openharness-icon.png"),
  resolve(frontendDist, "openharness-icon.png"),
);

console.log(">> OpenHarness runtime branding applied");
