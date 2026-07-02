async def run(ctx):
    greeting = ctx.env.get("GREETING", "Hello")
    target = ctx.params.get("TARGET", "Autoforge")

    ctx.stage(name="greet", label="问候", message="准备输出")
    ctx.progress(scope="task", current=1, total=1, label="问候", unit="步")

    ctx.log("INFO", f"{greeting}, {target}!")
    return {"message": f"{greeting}, {target}!", "language": "python"}
