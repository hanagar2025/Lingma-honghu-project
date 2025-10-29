# 📦 步骤 1：安装 Homebrew

## 🎯 目标
安装 Homebrew 包管理器，用于安装 MySQL 和 Redis。

## 📝 操作步骤

### 方法一：自动化安装（推荐）

在终端运行以下命令：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 安装过程说明

1. **下载安装脚本**
   - 脚本会自动下载并安装 Homebrew

2. **权限设置**
   - 可能需要输入管理员密码
   - 按照提示操作即可

3. **添加到系统路径**
   - 安装完成后，按照提示将 Homebrew 添加到 PATH
   - 通常会提示运行类似命令：
   ```bash
   echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
   eval "$(/opt/homebrew/bin/brew shellenv)"
   ```

### 验证安装

```bash
# 检查 Homebrew 版本
brew --version

# 应该显示类似: Homebrew 4.x.x
```

## ✅ 完成标志

看到 `Homebrew 4.x.x` 即表示安装成功！

## ⏭️ 下一步

安装完成后，运行：
```bash
./install_dependencies.sh
```

或继续步骤 2。

## ❓ 常见问题

### Q: 安装失败怎么办？
A: 
1. 检查网络连接
2. 确保已登录管理员账户
3. 访问官网查看最新安装方法：https://brew.sh/

### Q: 需要多长时间？
A: 通常在 5-10 分钟内完成

---

**准备好后，运行上面提到的安装命令，然后告诉我已完成。**

