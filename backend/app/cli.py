"""Command-line tools.

    python -m app.cli create-admin <email> <password> [name]   create an admin, or reset their password
    python -m app.cli seed                                      load the sample IBS paper and a demo drive
    python -m app.cli migrate                                   bring the database schema up to date
"""

import argparse
import asyncio
import json
import sys

from app import db
from app.core.security import hash_password
from app.migrate import run_migrations

SAMPLE_TITLE = "Campus Placement Drive – IBS (sample)"
SAMPLE_INSTRUCTIONS = "\n".join([
    "There are objective questions only.",
    "Each question carries 1 mark.",
    "There are no negative marks for a wrong answer.",
    "Please mark only one answer for each question.",
])
SAMPLE_PASSAGE = (
    "In recent years, many organizations have adopted hybrid work models, claiming improved productivity and employee satisfaction. "
    "However, emerging data suggests that while individual output may increase, collaboration and innovation may suffer. "
    "Informal interactions — once common in physical workplaces — are difficult to replicate virtually. Consequently, firms must balance "
    "flexibility with structured in-person engagement to preserve organizational creativity."
)
SYNONYMS = [
    ("Pragmatic", ["Idealistic", "Practical", "Emotional", "Theoretical"], 1),
    ("Ambiguous", ["Clear", "Vague", "Precise", "Transparent"], 1),
    ("Lucrative", ["Profitable", "Doubtful", "Harmful", "Generous"], 0),
    ("Viable", ["Feasible", "Visible", "Temporary", "Expensive"], 0),
    ("Arbitrary", ["Logical", "Random", "Necessary", "Strict"], 1),
]
READING = [
    ("The primary purpose of the passage is to:", ["Advocate permanent remote work", "Compare productivity across industries",
     "Examine trade-offs in hybrid work models", "Argue against workplace flexibility", "Prove innovation declines in remote settings"], 2),
    ("According to the passage, hybrid work may negatively impact:", ["Employee morale", "Compensation models", "Individual productivity",
     "Informal collaboration", "Office real estate costs"], 3),
]


async def create_admin(email: str, password: str, name: str) -> None:
    row = await db.one(
        """INSERT INTO admins (name, email, password_hash) VALUES (:n, :e, :h)
           ON CONFLICT (email) DO UPDATE SET password_hash = excluded.password_hash RETURNING (xmax = 0) AS created""",
        n=name, e=email.strip().lower(), h=hash_password(password),
    )
    print(f"Admin {email} created." if row["created"] else f"Password for {email} was reset.")


async def seed() -> None:
    if await db.one("SELECT id FROM exams WHERE title = :t", t=SAMPLE_TITLE):
        print("Sample exam already exists; nothing to do.")
        return
    async with db.transaction() as tx:
        exam = await tx.value("INSERT INTO exams (title, duration_min, instructions) VALUES (:t, 60, :i) RETURNING id", t=SAMPLE_TITLE, i=SAMPLE_INSTRUCTIONS)
        s1 = await tx.value("INSERT INTO sections (exam_id, name, hint, position) VALUES (:e, 'Synonyms', 'Choose the word closest in meaning', 1) RETURNING id", e=exam)
        s2 = await tx.value(
            "INSERT INTO sections (exam_id, name, hint, position) VALUES (:e, 'Reading Comprehension', 'Read the passage and answer the questions', 2) RETURNING id",
            e=exam,
        )
        passage = await tx.value("INSERT INTO passages (exam_id, title, body) VALUES (:e, 'Hybrid Work', :b) RETURNING id", e=exam, b=SAMPLE_PASSAGE)
        pos = 0
        for section, passage_id, items in ((s1, None, SYNONYMS), (s2, passage, READING)):
            for text, options, correct in items:
                pos += 1
                await tx.run(
                    """INSERT INTO questions (exam_id, section_id, passage_id, position, text, options, correct_index)
                       VALUES (:e, :s, :p, :pos, :t, CAST(:o AS jsonb), :c)""",
                    e=exam, s=section, p=passage_id, pos=pos, t=text, o=json.dumps(options), c=correct,
                )
        await tx.run(
            """INSERT INTO drives (code, name, college, exam_id, drive_date)
               VALUES ('ibs-demo', 'Campus Placement Drive – IBS', 'IBS (demo)', :e, current_date) ON CONFLICT (code) DO NOTHING""",
            e=exam,
        )
    print("Loaded sample exam (7 questions) and demo drive. Student link: /d/ibs-demo")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description="Rite Exam Portal tools")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("create-admin", help="create an admin, or reset an admin's password")
    admin.add_argument("email")
    admin.add_argument("password")
    admin.add_argument("name", nargs="*", default=["Administrator"])
    sub.add_parser("seed", help="load the sample IBS paper and a demo drive")
    sub.add_parser("migrate", help="bring the database schema up to date")
    args = parser.parse_args(argv)

    run_migrations()
    if args.command == "create-admin":
        if len(args.password) < 8:
            print("The password must be at least 8 characters.", file=sys.stderr)
            return 1
        asyncio.run(create_admin(args.email, args.password, " ".join(args.name) or "Administrator"))
    elif args.command == "seed":
        asyncio.run(seed())
    else:
        print("Database is up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
