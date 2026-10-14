"""Admin login, admin users and passwords."""

import re
from typing import Any

from fastapi import APIRouter, Depends, Response

from app import db
from app.api.deps import id_param, json_body, require_admin
from app.core.errors import HttpError, bad_request, conflict
from app.core.forms import Form
from app.core.rate_limit import login_limit
from app.core.security import hash_password, sign_admin, verify_password

public = APIRouter(prefix="/api/admin", tags=["admin: login"])
router = APIRouter(prefix="/api/admin", tags=["admin: users"], dependencies=[Depends(require_admin)])


@public.post("/login", dependencies=[Depends(login_limit)])
async def login(body: dict = Depends(json_body)) -> dict[str, Any]:
    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    admin = await db.one("SELECT * FROM admins WHERE email = :email", email=email)
    if not admin or not verify_password(password, admin["password_hash"]):
        raise HttpError(401, "Incorrect email or password.")
    return {"token": sign_admin(admin), "admin": {"id": admin["id"], "name": admin["name"], "email": admin["email"]}}


@router.get("/me")
async def me(admin: dict = Depends(require_admin)) -> dict[str, Any]:
    return admin


@router.get("/admins")
async def list_admins() -> list[dict[str, Any]]:
    return await db.all("SELECT id, name, email, created_at FROM admins ORDER BY name")


@router.post("/admins", status_code=201)
async def add_admin(body: dict = Depends(json_body)) -> dict[str, Any]:
    f = Form(body)
    name = f.str("name", "Name", max=100)
    email = f.str("email", "Email", max=254).lower()
    password = str(body.get("password") or "")
    if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}", email):
        f.error("email", "Enter a valid email address.")
    if len(password) < 8:
        f.error("password", "Password must be at least 8 characters.")
    f.done()
    if await db.one("SELECT 1 FROM admins WHERE email = :email", email=email):
        raise conflict("An admin with this email already exists.", fields={"email": "Already exists."})
    return await db.one(
        "INSERT INTO admins (name, email, password_hash) VALUES (:name, :email, :hash) RETURNING id, name, email, created_at",
        name=name, email=email, hash=hash_password(password),
    )


@router.delete("/admins/{admin_id}", status_code=204)
async def remove_admin(admin_id: str, admin: dict = Depends(require_admin)) -> Response:
    target = id_param(admin_id)
    if target == admin["id"]:
        raise bad_request("You cannot delete your own account.")
    await db.run("DELETE FROM admins WHERE id = :id", id=target)
    return Response(status_code=204)


@router.put("/me/password", status_code=204)
async def change_password(body: dict = Depends(json_body), admin: dict = Depends(require_admin)) -> Response:
    current = await db.one("SELECT * FROM admins WHERE id = :id", id=admin["id"])
    if not current or not verify_password(str(body.get("currentPassword") or ""), current["password_hash"]):
        raise bad_request("Current password is incorrect.", fields={"currentPassword": "Incorrect password."})
    new = str(body.get("newPassword") or "")
    if len(new) < 8:
        raise bad_request("New password must be at least 8 characters.", fields={"newPassword": "At least 8 characters."})
    await db.run("UPDATE admins SET password_hash = :hash WHERE id = :id", id=current["id"], hash=hash_password(new))
    return Response(status_code=204)
