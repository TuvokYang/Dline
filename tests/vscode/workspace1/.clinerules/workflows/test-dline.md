---
description: "测试 Dline 核心能力的系统化工作流，涵盖并行 I/O、代码分析、子代理、MCP 集成和独立任务分发。"
author: "Dline Team"
version: "1.0"
category: "Testing"
tags: ["testing", "parallel", "mcp", "subagent", "spawn-task", "code-analysis"]
globs: ["test-dline/src/**/*.py"]
---

<task name="Dline 核心能力测试">

<task_objective>
系统化测试 Dline 的核心能力：并行文件 I/O（写入/读取/替换）、代码结构分析、子代理并行执行、MCP 工具集成以及独立任务分发。创建 6 个 Python 模块作为测试工件，通过顺序工作流逐项验证各项能力。
</task_objective>

<detailed_sequence_steps>
# Dline 核心能力测试 - 详细步骤

## 准备工作：清理工作区

1. 测试文件统一存放在 `test-dline/` 目录下，避免污染其他目录。

2. 在执行任何工作流之前，先检查 `test-dline/src/` 目录是否已存在。如果存在，运行删除命令清空：
   - Windows: `rmdir /s /q tests\src`
   - 确保每次测试从干净状态开始，避免上次运行残留文件。

3. 如果 `test-dline/src/` 不存在，直接进入 Workflow 1。

## Workflow 1: 并行文件写入

1. 如果 `test-dline/src/` 目录不存在，先创建它。

2. 在同一轮并行批次中，使用 `write_to_file` 创建 6 个 Python 模块文件，每个 100 行以上：
   - `test-dline/src/module_auth.py` —— JWT 认证、PBKDF2 密码哈希、RBAC（UserRole 枚举）、TokenManager（HMAC-SHA256 签名）、AuthGuard（角色层级和权限检查）。包含自定义异常类（AuthError、TokenExpiredError、InvalidTokenError、PermissionDeniedError）。
   - `test-dline/src/module_db.py` —— SQLite ORM 抽象层，包含 ConnectionPool（线程安全）、QueryBuilder（流式 API：select/where/order_by/limit/offset/group_by）、Database 类（CRUD：insert/fetch_all/fetch_one/update/delete/count/table_exists）、事务上下文管理器。包含 Column 和 Table 模式定义。
   - `test-dline/src/module_api.py` —— 轻量 HTTP 框架，包含 Router（正则路径参数匹配、中间件管道、前置/后置钩子、错误处理器）、Request/Response 数据类、封装 stdlib HTTPServer 的 ApiServer、内置 cors_middleware 和 logging_middleware。支持 HttpMethod 和 HttpStatus 枚举。
   - `test-dline/src/module_models.py` —— Pydantic 风格 BaseModel，支持验证（类型检查、Union/Optional 处理）、类型强制转换、dict()/json() 序列化。包含 FieldValidator（required/min_length/max_length/pattern/range）、Field 描述符，以及示例模型（UserModel、ProductModel、OrderModel、UserProfile）。
   - `test-dline/src/module_utils.py` —— 工具集：ColorFormatter 彩色控制台日志、setup_logger、retry 装饰器（指数退避 + 随机抖动）、LRUCache（线程安全，支持 TTL 和统计）、memoize、deep_merge、chunk_list、flatten、generate_id、timer 上下文管理器。
   - `test-dline/src/module_config.py` —— 分层 ConfigManager，ConfigSource 优先级（DEFAULT < FILE < ENV < OVERRIDE），Schema 注册（type/choices/min/max 验证），JSON 文件加载，环境变量解析（含类型强制转换），变更监听器，export/dump/validate_all 方法。包含全局单例模式。

3. 每个模块必须包含完整的 docstring、类型注解，且完全自包含（无需跨模块导入）。

## Workflow 2: 并行文件读取

1. 使用 `read_file`，在同一轮并行批次中读取全部 6 个 `test-dline/src/` 下的模块文件的前 5 行。

2. 验证每个文件存在、文档字符串正确、总行数统计准确。

## Workflow 3: 批量文件替换

1. 使用 `replace_in_file`，在同一轮并行批次中执行 3 处替换：
   - `test-dline/src/module_auth.py`：升级 PasswordHasher —— ITERATIONS 从 600_000 提升到 1_200_000，添加 VERSION = "v2" 类属性，更新文档字符串说明支持算法迁移。
   - `test-dline/src/module_db.py`：在 `insert()` 方法之后新增 `batch_insert(self, table_name, rows)` 方法 —— 接受 List[Dict]，在单个事务中执行，返回插入行数，失败时回滚。
   - `test-dline/src/module_utils.py`：在 `timer` 上下文管理器之前新增 `timeit` 装饰器（支持 `@timeit` 和 `@timeit(name="label")` 两种形式）—— 自动测量并记录函数执行时间，智能选择单位（ms/s/min）。

2. 验证替换是否正确应用 —— 对 `test-dline/src/` 运行 `list_code_definition_names`，确认 `batch_insert`、`VERSION`、`timeit` 出现在输出中。

## Workflow 4: 代码定义分析

1. 对 `test-dline/src/` 目录执行 `list_code_definition_names`。

2. 确认全部 6 个文件的所有类、方法、函数都被列出，且标注精确的行号范围。

3. 验证 Workflow 3 的修改在定义列表中可见。

## Workflow 5: 子代理并行执行

1. 使用 `use_subagents` 并行启动 3 个子代理，分别在 Windows 上执行 ping 命令：
   - 子代理 1: `ping -n 3 127.0.0.1`
   - 子代理 2: `ping -n 3 localhost`
   - 子代理 3: `ping -n 3 8.8.8.8`

2. 每个子代理必须独立完成：
   - 记录开始和结束时间戳。
   - 执行分配的 ping 命令。
   - 报告丢包率和往返时间。

3. 验证全部 3 个子代理成功完成（Succeeded: 3, Failed: 0）。

## Workflow 6: MCP 工具集成

1. 并行执行以下 MCP 操作（工具名称因环境而异 —— Dline 应自动发现可用工具）：
   - **网络搜索**：搜索当前技术热点，返回 5 条相关结果（含 URL 和摘要）。
   - **知识图谱读取**：获取所有已有实体和关系。
   - **知识图谱搜索**：按关键词搜索节点。
   - **知识图谱写入**：为每个模块创建一个实体（Module_Auth、Module_DB、Module_API、Module_Models、Module_Utils、Module_Config），备注行数和关键特性。然后创建 `depends_on` 关系：Module_API→Module_Auth、Module_API→Module_DB、Module_Auth→Module_Config、Module_DB→Module_Config。
   - **链式推理**：使用多步推理分析 6 个模块的架构设计 —— 评估分层设计、依赖流向、SOLID 原则遵循度及可扩展性。

2. 重新读取知识图谱，确认所有实体和关系已持久化。

## Workflow 7: 独立子任务分发

1. 使用 `spawn_task` 创建一个独立子任务：
   - 创建 `test-dline/src/__init__.py` 作为 Python 包文件。
   - 导入并重新导出全部 6 个模块的关键类和函数。
   - 定义 `__all__` 公开 API 列表。
   - 设置 `__version__ = "1.0.0"`。
   - 每个导入用 try/except 包裹，避免缺失模块时报错。
   - 包含包级文档字符串："Dline Framework - 轻量模块化 Python Web 框架"。

2. 子任务在独立编辑器 Tab 中自主运行 —— 主测试工作流不等待其完成。

</detailed_sequence_steps>

</task>
