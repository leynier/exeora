use std::{fs, sync::OnceLock};

use exeora_cli::{error::ErrorCode, protocol::ToolName, tools::ToolEngine};
use serde_json::json;
use tempfile::TempDir;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

fn home_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

struct HomeGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
}

impl HomeGuard {
    fn set(home: &std::path::Path) -> Self {
        let key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        let previous = std::env::var_os(key);
        unsafe { std::env::set_var(key, home) };
        Self { key, previous }
    }
}

impl Drop for HomeGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(value) => unsafe { std::env::set_var(self.key, value) },
            None => unsafe { std::env::remove_var(self.key) },
        }
    }
}

async fn call(
    engine: &ToolEngine,
    root: &TempDir,
    tool: ToolName,
    args: serde_json::Value,
) -> serde_json::Value {
    engine
        .execute(root.path(), tool, args, CancellationToken::new())
        .await
        .unwrap()
}

#[tokio::test]
async fn reads_global_agents_md_and_skill_files() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    let agents = home.path().join(".agents");
    let skill_dir = agents.join("skills").join("pdf-processing");
    fs::create_dir_all(&skill_dir).unwrap();
    fs::write(agents.join("AGENTS.md"), "global rules\n").unwrap();
    fs::write(skill_dir.join("SKILL.md"), "# pdf\n").unwrap();
    fs::write(agents.join("mcp-settings.json"), "{}\n").unwrap();

    let engine = ToolEngine::new().unwrap();
    let agents_md = call(
        &engine,
        &project,
        ToolName::ReadFile,
        json!({"path": "~/.agents/AGENTS.md"}),
    )
    .await;
    assert_eq!(agents_md["path"], "~/.agents/AGENTS.md");
    assert_eq!(agents_md["content"], "global rules");

    let skill = call(
        &engine,
        &project,
        ToolName::ReadFile,
        json!({"path": "~/.agents/skills/pdf-processing/SKILL.md"}),
    )
    .await;
    assert_eq!(skill["content"], "# pdf");

    let listed = call(
        &engine,
        &project,
        ToolName::ListFiles,
        json!({"path": "~/.agents/skills", "recursive": true}),
    )
    .await;
    let paths: Vec<_> = listed["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["path"].as_str().unwrap().to_owned())
        .collect();
    assert!(
        paths
            .iter()
            .any(|path| path == "~/.agents/skills/pdf-processing/SKILL.md")
    );
}

#[tokio::test]
async fn refuses_the_rest_of_dot_agents_and_writes() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    fs::create_dir_all(home.path().join(".agents").join("skills")).unwrap();
    fs::write(
        home.path().join(".agents").join("mcp-settings.json"),
        "{}\n",
    )
    .unwrap();
    fs::write(home.path().join(".agents").join("AGENTS.md"), "rules\n").unwrap();

    let engine = ToolEngine::new().unwrap();
    let secret = engine
        .execute(
            project.path(),
            ToolName::ReadFile,
            json!({"path": "~/.agents/mcp-settings.json"}),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(secret.code, ErrorCode::PathEscape);

    let listed = engine
        .execute(
            project.path(),
            ToolName::ListFiles,
            json!({"path": "~/.agents"}),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(listed.code, ErrorCode::PathEscape);

    let write = engine
        .execute(
            project.path(),
            ToolName::WriteFile,
            json!({"path": "~/.agents/AGENTS.md", "content": "nope\n"}),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(write.code, ErrorCode::PathEscape);
}

#[tokio::test]
async fn command_cwd_can_be_a_skill_directory() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    let skill_dir = home
        .path()
        .join(".agents")
        .join("skills")
        .join("pdf-processing");
    fs::create_dir_all(&skill_dir).unwrap();
    fs::write(skill_dir.join("marker.txt"), "from-skill\n").unwrap();

    let engine = ToolEngine::new().unwrap();
    let command = if cfg!(windows) {
        "type marker.txt"
    } else {
        "cat marker.txt"
    };
    let output = call(
        &engine,
        &project,
        ToolName::RunCommand,
        json!({
            "command": command,
            "cwd": "~/.agents/skills/pdf-processing"
        }),
    )
    .await;
    assert_eq!(output["exitCode"], 0);
    assert!(output["stdout"].as_str().unwrap().contains("from-skill"));
}

#[tokio::test]
async fn lists_user_and_project_skills_with_project_winning() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());

    let user_pdf = home.path().join(".agents").join("skills").join("pdf");
    fs::create_dir_all(&user_pdf).unwrap();
    fs::write(
        user_pdf.join("SKILL.md"),
        "---\nname: pdf\ndescription: User PDF skill.\n---\n",
    )
    .unwrap();
    let user_hidden = home.path().join(".agents").join("skills").join("hidden");
    fs::create_dir_all(&user_hidden).unwrap();
    fs::write(
        user_hidden.join("SKILL.md"),
        "---\ndescription: Hidden.\ndisable-model-invocation: true\n---\n",
    )
    .unwrap();
    fs::write(
        home.path().join(".agents").join("skills").join("README.md"),
        "no\n",
    )
    .unwrap();

    let project_pdf = project.path().join(".agents").join("skills").join("pdf");
    fs::create_dir_all(&project_pdf).unwrap();
    fs::write(
        project_pdf.join("SKILL.md"),
        "---\nname: pdf\ndescription: Project PDF skill.\n---\n",
    )
    .unwrap();
    let project_lint = project.path().join(".agents").join("skills").join("lint");
    fs::create_dir_all(&project_lint).unwrap();
    fs::write(
        project_lint.join("SKILL.md"),
        "---\ndescription: Lint the repo.\n---\n",
    )
    .unwrap();

    let engine = ToolEngine::new().unwrap();
    let listed = engine
        .execute(
            project.path(),
            ToolName::ListSkills,
            json!({}),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    let skills = listed["skills"].as_array().unwrap();
    let names: Vec<_> = skills
        .iter()
        .map(|skill| skill["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["lint", "pdf"]);

    let pdf = skills.iter().find(|skill| skill["name"] == "pdf").unwrap();
    assert_eq!(pdf["source"], "project");
    assert_eq!(pdf["description"], "Project PDF skill.");
    assert_eq!(pdf["path"], ".agents/skills/pdf/SKILL.md");
}

#[tokio::test]
async fn lists_user_skills_when_the_project_has_none() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    let user = home.path().join(".agents").join("skills").join("search");
    fs::create_dir_all(&user).unwrap();
    fs::write(
        user.join("SKILL.md"),
        "---\nname: search\ndescription: Search the web.\n---\n",
    )
    .unwrap();

    let engine = ToolEngine::new().unwrap();
    let listed = engine
        .execute(
            project.path(),
            ToolName::ListSkills,
            json!({}),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(listed["skills"][0]["source"], "user");
    assert_eq!(
        listed["skills"][0]["path"],
        "~/.agents/skills/search/SKILL.md"
    );
}

#[tokio::test]
async fn lists_and_greps_global_agents_md_as_a_file() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    fs::create_dir_all(home.path().join(".agents").join("skills")).unwrap();
    fs::write(
        home.path().join(".agents").join("AGENTS.md"),
        "global rules\nkeep going\n",
    )
    .unwrap();

    let engine = ToolEngine::new().unwrap();
    let listed = call(
        &engine,
        &project,
        ToolName::ListFiles,
        json!({"path": "~/.agents/AGENTS.md"}),
    )
    .await;
    assert_eq!(listed["path"], "~/.agents/AGENTS.md");
    let entries = listed["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["path"], "~/.agents/AGENTS.md");
    assert_eq!(entries[0]["type"], "file");

    let grepped = call(
        &engine,
        &project,
        ToolName::Grep,
        json!({"pattern": "global rules", "path": "~/.agents/AGENTS.md"}),
    )
    .await;
    assert_eq!(grepped["matches"][0]["path"], "~/.agents/AGENTS.md");
    assert_eq!(grepped["matches"][0]["text"], "global rules");
}

#[tokio::test]
async fn parent_dir_cannot_leave_the_skills_root() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    fs::create_dir_all(home.path().join(".agents").join("skills").join("pdf")).unwrap();
    fs::write(home.path().join(".secret"), "leaked\n").unwrap();

    let engine = ToolEngine::new().unwrap();
    let escaped = "~/.agents/skills/pdf/../../../.secret";
    for tool in [ToolName::ReadFile, ToolName::ListFiles, ToolName::Grep] {
        let args = if tool == ToolName::Grep {
            json!({"pattern": "leaked", "path": escaped})
        } else {
            json!({"path": escaped})
        };
        let error = engine
            .execute(project.path(), tool, args, CancellationToken::new())
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::PathEscape, "{tool:?}");
    }

    let cwd = engine
        .execute(
            project.path(),
            ToolName::RunCommand,
            json!({"command": "pwd", "cwd": "~/.agents/skills/pdf/../.."}),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(cwd.code, ErrorCode::PathEscape);
}

#[tokio::test]
async fn lists_a_skill_with_a_folded_description() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    let skill = home.path().join(".agents").join("skills").join("review");
    fs::create_dir_all(&skill).unwrap();
    fs::write(
        skill.join("SKILL.md"),
        "---\nname: review\ndescription: >-\n  Run a reviewer subagent.\n  Local and branch modes write a file.\n---\n",
    )
    .unwrap();

    let engine = ToolEngine::new().unwrap();
    let listed = engine
        .execute(
            project.path(),
            ToolName::ListSkills,
            json!({}),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(listed["skills"][0]["name"], "review");
    assert_eq!(
        listed["skills"][0]["description"],
        "Run a reviewer subagent. Local and branch modes write a file."
    );
}

#[tokio::test]
async fn empty_when_nothing_is_installed() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    let engine = ToolEngine::new().unwrap();
    let listed = engine
        .execute(
            project.path(),
            ToolName::ListSkills,
            json!({}),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(listed["skills"], json!([]));
}

fn symlink_file(original: &std::path::Path, link: &std::path::Path) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(original, link).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(original, link).unwrap();
}

#[tokio::test]
async fn reads_global_agents_md_through_a_renamed_symlink() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());
    fs::create_dir_all(home.path().join(".agents").join("skills")).unwrap();
    let target = home.path().join("codex").join("instructions.md");
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::write(&target, "from-symlink\n").unwrap();
    symlink_file(&target, &home.path().join(".agents").join("AGENTS.md"));

    let engine = ToolEngine::new().unwrap();
    let agents_md = call(
        &engine,
        &project,
        ToolName::ReadFile,
        json!({"path": "~/.agents/AGENTS.md"}),
    )
    .await;
    assert_eq!(agents_md["path"], "~/.agents/AGENTS.md");
    assert_eq!(agents_md["content"], "from-symlink");
}

#[tokio::test]
async fn skips_skills_that_fail_the_name_spec() {
    let _lock = home_lock().lock().await;
    let home = TempDir::new().unwrap();
    let project = TempDir::new().unwrap();
    let _home = HomeGuard::set(home.path());

    let upper = home.path().join(".agents").join("skills").join("BadName");
    fs::create_dir_all(&upper).unwrap();
    fs::write(
        upper.join("SKILL.md"),
        "---\nname: BadName\ndescription: Uppercase name.\n---\n",
    )
    .unwrap();
    let mismatch = home
        .path()
        .join(".agents")
        .join("skills")
        .join("pdf-processing");
    fs::create_dir_all(&mismatch).unwrap();
    fs::write(
        mismatch.join("SKILL.md"),
        "---\nname: pdf\ndescription: Name does not match the directory.\n---\n",
    )
    .unwrap();
    let ok = home.path().join(".agents").join("skills").join("search");
    fs::create_dir_all(&ok).unwrap();
    fs::write(
        ok.join("SKILL.md"),
        "---\nname: search\ndescription: Search the web.\n---\n",
    )
    .unwrap();

    let engine = ToolEngine::new().unwrap();
    let listed = engine
        .execute(
            project.path(),
            ToolName::ListSkills,
            json!({}),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    let names: Vec<_> = listed["skills"]
        .as_array()
        .unwrap()
        .iter()
        .map(|skill| skill["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, vec!["search"]);
}
