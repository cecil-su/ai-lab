use agentparty_main_service::{run, ServiceConfig};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = ServiceConfig::from_env()?;
    run(config).await
}
