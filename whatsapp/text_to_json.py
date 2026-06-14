import re
import json
from datetime import datetime
import typer
from pathlib import Path

app = typer.Typer()


def parse_chat(filename: Path):
    messages = []
    pattern = r"^[^\[]*\[([^\]]+)\]\s+([^:]+):\s+(.*)$"
    with open(filename, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            match = re.match(pattern, line)
            if match:
                timestamp_str = match.group(1)
                sender = match.group(2)
                message = match.group(3)
                try:
                    timestamp = datetime.strptime(timestamp_str, "%d/%m/%Y %H:%M:%S")
                    timestamp_iso = timestamp.isoformat()
                except ValueError:
                    # If the date format is different, keep the original string
                    timestamp_iso = timestamp_str
                messages.append(
                    {"datetime": timestamp_iso, "sender": sender, "message": message}
                )
            else:
                # If the line does not match the pattern, it may be a continuation of the previous message
                if messages:
                    messages[-1]["message"] += "\n" + line
    return messages


@app.command()
def parse(input_file: Path, output_file: Path = "chat.json"):
    """
    Parse a WhatsApp chat file and save the result in JSON format.

    Args:
    - input_file: Text file extracted from WhatsApp (chat.txt).
    - output_file: Name of the output JSON file (default: chat.json).
    """
    if not input_file.exists():
        typer.echo(f"Error: The file {input_file} does not exist.")
        raise typer.Exit(code=1)

    typer.echo(f"Reading file {input_file}...")
    messages = parse_chat(input_file)

    typer.echo(f"Saving to file {output_file}...")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=4)

    typer.echo(f"JSON file successfully generated: {output_file}")


if __name__ == "__main__":
    app()
