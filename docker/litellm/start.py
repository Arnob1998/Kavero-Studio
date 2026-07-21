import os
import shutil

import kavero_auth


def main() -> None:
    kavero_auth.validate_configuration()
    executable = shutil.which("litellm")
    if not executable:
        raise RuntimeError("LiteLLM executable is unavailable")
    os.execv(
        executable,
        [executable, "--port", "4000", "--config", "/app/config.yaml"],
    )


if __name__ == "__main__":
    main()
