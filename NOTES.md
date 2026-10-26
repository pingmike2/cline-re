# 逆向与实测笔记

记录这个项目从零到可用的过程，以及踩过的坑。不是 API 文档，是"当时怎么想的、
哪里判断错了、最后什么方法有效"。

---

## 一、起点：不要跟二进制较劲

最初的目标是"把 Cline CLI 拆开看"。第一步自然是 `npm pack` 然后解。

```
cline@3.0.74           48 KB    6 行 spawn 启动器
@cline/cli-linux-arm64 53 MB    Bun 单文件
@cline/cli-linux-x64  155 MB    Bun 单文件
```

前面都很顺，到二进制就卡住了。Bun 的 standalone 格式把模块表追加在
`---- Bun! ----` trailer 之后，早期版本是明文 JS，可以直接 carv 出来。
但 3.0.x 这里是**加密资产块**，`strings`、trailer 切割、按已知模块图重建，
三条路全部失败。

这一步花了最多时间，也最没价值。**教训：当一条路需要"破解加密"时，
它大概率不是正确路径。** 真正的突破来自承认"这个二进制我不需要拆"。

## 二、真正的三个信息面

换思路之后，同样的信息用完全合法的手段拿到了：

**1. TypeScript 声明文件。** SDK 拆成四个包发布：

```
@cline/core    27 MB   编排器、工具、提示词组装
@cline/agents          单轮工具循环（AgentRuntime）
@cline/shared          协议类型
@cline/llms            Vercel AI SDK 多 provider 适配
```

`.d.ts` 把运行时契约写得比源码注释还清楚。`agent-runtime.d.ts` 里直接能看到
单轮工具循环的输入输出形状。

**2. 开源 app 壳。** `apps/cli/src/{index,main}.ts` 在 master 上是
`Bun.isStandaloneExecutable` 判断编译体，版本 3.0.74，和 npm 发布版**完全一致**。
这意味着发布二进制和开源壳是同一份代码编译出来的。

**3. 活体流量。** 头部、认证、SSE 分帧，只能靠实际请求看。

**这一节的核心结论：闭源 ≠ 不可知。** 声明文件、开源壳、协议流量，
三个面交叉验证，能还原出比读混淆代码更准确的结果。

## 三、两个坑，都不在文档里

### `workos:` 前缀

拿到 `access_token` 直接当 Bearer 用，稳定 401。

正确的形式是：

```
Authorization: Bearer workos:<access_token>
```

这个前缀没有任何文档提及。它是 WorkOS 的 token 类型标记，Cline 网关
在校验时会剥掉前缀再验签。少这四个字符就全盘失败。

### refresh 走的是 Cline 自己的端点，不是 WorkOS

直觉上 refresh 应该打 WorkOS 的 `/oauth/token`。实际不是：

```
POST https://api.cline.bot/api/v1/auth/refresh
{ "refreshToken": "...", "grantType": "refresh_token" }
```

注意是 **camelCase** 的 `refreshToken`，不是 OAuth 标准的 `refresh_token`。
这一点在有多个实现参考时特别容易搞错——如果看到 `{refresh_token, grant_type}`
的写法，那是另一套协议。

## 四、客户端指纹不是装饰

网关会拒绝"不像官方客户端"的请求。这些头是**必需**的：

```
User-Agent: Cline/3.0.74
HTTP-Referer: https://cline.bot
X-Title: Cline
X-IS-MULTIROOT: false
X-CLIENT-TYPE: cline-sdk
X-CLIENT-VERSION: 3.0.74
X-PLATFORM: terminal
X-PLATFORM-VERSION: 3.0.74
X-CORE-VERSION: 0.0.66
X-Task-ID: <session id>
```

少一组 `X-*` 就直接 `403 ... is only available via Cline product surfaces`。

这里有个判断值得记下来：**`X-CORE-VERSION: 0.0.66` 和 CLI 版本号 3.0.74
不是一回事。** 前者是 `@cline/core` 的版本，后者是 `apps/cli` 的版本，
混用会被拒。第一次对不上就是因为这个。

## 五、模型分层：一个容易误判的边界

`/ai/cline/recommended-models` 返回三个互斥分支：

| 分支 | API 可用 | 原因 |
|---|---|---|
| `data.free` (`cline-free/*`) | **可以** | 免费额度，不扣 credits |
| `data.clineCloud/*` | 不行，403 | 绑定 Cloud Agents 浏览器沙箱 |
| `data.clinePass/*` | 不行，403 | 需要付费订阅 |

`cline-cloud/*` 的 403 很值得说。一开始怀疑是头不对，于是拿官方 CLI
**同一个 token、同一套指纹**去请求，结果一模一样 403。

**结论：那批模型绑定的是沙箱会话，不是账号。** 这不是参数问题，
是服务端路由问题，任何客户端都过不去。确认这一点省了大量瞎试。

判断方法：**当你的行为和参考实现完全一致却依然失败时，问题不在你这边。**

## 六、真正难的是 plan 模式的只读保证

工具循环、SSE 拼装、会话持久化都不难。真正有难度的是
"在 plan 模式下保证一个字都不写"。

官方把这套逻辑压缩在一个 `TP()` 里，我拆成六张静态规则表：

```
SHELL_WRAPPERS       11    sudo / env / nice / timeout / xargs ...
SHELL_KEYWORDS       15    if / while / for / case ...
FILE_MUTATORS        47    rm / mv / cp / dd / tee / sed -i ...
GIT_WRITERS          22    add / commit / reset / checkout ...
PKG_WRITERS          17    npm install / pip / apt / brew ...
WRITE_SUBCOMMANDS    23
```

配合重定向检测，只允许写 `/tmp` 和 `/dev/null`。

### 这里我自己写出了一个真 bug

测试时让 agent 执行 `echo hacked > /tmp/project/src/pwned.txt`，
**写进去了**。

根因：`isAllowedRedirectTarget()` 判断"路径是否以 `/tmp/` 开头"。
当项目本身就在 `/tmp` 下时，仓库内的每个路径都看起来安全。

修复思路是把判断基准从"字符串前缀"换成"**相对 cwd 的归属**"：

```js
if (cwd && t.startsWith("/")) {
  const root = cwd.endsWith("/") ? cwd : `${cwd}/`;
  if (t === cwd || t.startsWith(root)) return false;
}
```

**教训：白名单判断必须基于"这个东西属于谁"，而不是"它的名字长什么样"。**
基于字符串前缀的放行，永远会被路径构造绕过。这条值 87 个测试里的那 1 个。

## 七、拿真实仓库做审计的四次迭代

我拿一个 13.3k 行的真实网关仓库跑 `-p` 审计，免费模型 25 轮迭代、168 秒。

**结果：5 条重点里 2 条真、3 条误报。**

### 真的

- `warp-topup.py:88` 的 `subprocess.run(c, shell=True)` —— 定位到具体行号，
  这个观察是对的
- systemd `EnvironmentFile` 加载明文密钥 —— 密钥会经 `/proc/<pid>/environ`
  暴露，判断正确

### 误报

它报告 `deploy/zen.env` 和 `newapi/conf/pool.env` 硬编码密钥"已泄露"。
核实：**这两个文件根本没被 git 跟踪**，权限 `600`。

它还报告 `server.js:357` 打印完整请求体含密钥。核实：实际只打
`stream / model / max_tokens / body_bytes`，**不碰 body**。

### 误报为什么发生

它看到"文件存在 + 内容有密钥"，就跳到"已泄露"。缺的是一步
`git ls-files` 的核实，以及真的读一遍那行 `console.log`。

**这暴露了 LLM 审计的系统性弱点：它善于"发现可疑信号"，不善于"证伪自己的结论"。**
所以提示词里应该显式要求"判断泄漏前先查 git 跟踪状态"，
而不是指望它自己想到。

反过来，它对两条路径穿越的判断是"设计如此，可接受"——因为那是运维自己的
环境变量，能改环境变量的人本来就有 shell。这个边界感是对的，
说明它不只是背规则，也做了威胁建模。

## 八、几条可以直接复用的经验

**1. 信息面比努力重要。** 拆加密二进制花了最多时间，收益为零。
换成声明文件 + 开源壳 + 流量，一小时内全部打通。

**2. 和参考实现对齐是最快的定位法。** 行为一致却失败，说明问题在服务端
或设计边界，不在你的代码。这条让我及时停止了在 `cline-cloud` 上瞎试。

**3. 校验边界要按"归属"而不是"字面"设计。** 白名单用字符串前缀，
一定被路径构造绕过。

**4. LLM 产出必须验证。** 168 秒、25 轮、看起来很有条理的报告，
核实后 60% 的重点是误报。它给的是"线索"，不是"结论"。

**5. 免费模型的真实成本是迭代数，不是钱。** solar-mini4 会把简单任务
拆成 4-7 轮，遇到硬性拒绝（plan 模式拦截）还会反复重试。
`--max-iterations` 是必需品，不是可选项。

---

## 附：这个项目最终的形状

```
src/   21 文件   1925 行
test/  12 文件     87 测试
依赖：0
```

能做的事：

```bash
cline-re login
cline-re -m solar-mini4 "读一下 app.js，add() 对不对"
cline-re -p "审计这个仓库的安全问题，只读"
cline-re --checkpoints "把 CommonJS 迁到 ESM"
```

一句话总结这条路径：**不去破解它，去理解它。**
声明文件、开源代码、协议流量，这三样东西加起来的说服力，
比任何解密工具都强，而且完全经得起推敲。
