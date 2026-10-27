"""Isolated authorization tests: no database, scheduler, or collection jobs.

Run: python -m unittest discover -s tests -p test_admin_page_access.py
"""
import ast
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

ROOT = Path(__file__).resolve().parents[1]


class AdminAccessTests(unittest.TestCase):
    def setUp(self):
        class User:
            user_id = 0

        def decode_token(token):
            if token != "valid":
                raise HTTPException(status_code=401)
            return {"user_id": 1}

        namespace = dict(
            Depends=Depends, HTTPException=HTTPException,
            HTTPAuthorizationCredentials=HTTPAuthorizationCredentials,
            bearer_scheme=HTTPBearer(auto_error=False), get_session=lambda: None,
            Session=object, User=User, decode_access_token=decode_token,
            select=lambda model: SimpleNamespace(where=lambda condition: None),
        )
        tree = ast.parse((ROOT / "back/routers/admin_users.py").read_text(encoding="utf-8"))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "get_admin_user")
        exec(compile(ast.Module(body=[function], type_ignores=[]), "admin_users.py", "exec"), namespace)
        self.check_admin = namespace["get_admin_user"]

    def test_roles_and_missing_or_invalid_token(self):
        for token, role, expected in [(None, "ADMIN", 401), ("invalid", "ADMIN", 401), ("valid", "USER", 403), ("valid", None, 401), ("valid", "ADMIN", 200)]:
            with self.subTest(token=token, role=role):
                user = SimpleNamespace(role=role) if role else None
                db = SimpleNamespace(scalar=lambda query: user)
                credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token) if token else None
                if expected == 200:
                    self.assertIs(self.check_admin(credentials, db), user)
                else:
                    with self.assertRaises(HTTPException) as caught:
                        self.check_admin(credentials, db)
                    self.assertEqual(caught.exception.status_code, expected)

    def test_both_router_dependencies_and_settlement(self):
        for filename in ("admin_baseball_data.py", "admin_predictions.py"):
            tree = ast.parse((ROOT / "back/routers" / filename).read_text(encoding="utf-8"))
            declaration = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "router" for t in n.targets))
            namespace = dict(APIRouter=APIRouter, Depends=Depends, get_admin_user=self.check_admin)
            exec(compile(ast.Module(body=[declaration], type_ignores=[]), filename, "exec"), namespace)
            self.assertIn(self.check_admin, [d.dependency for d in namespace["router"].dependencies])

        tree = ast.parse((ROOT / "back/routers/predictions.py").read_text(encoding="utf-8"))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "settle_game_votes")
        namespace = dict(router=APIRouter(), Depends=Depends, get_admin_user=self.check_admin)
        decorator = eval(compile(ast.Expression(function.decorator_list[0]), "predictions.py", "eval"), namespace)
        decorator(lambda: None)
        self.assertIn(self.check_admin, [d.dependency for d in namespace["router"].routes[0].dependencies])

        tree = ast.parse((ROOT / "back/routers/admin_users.py").read_text(encoding="utf-8"))
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "check_admin_access")
        namespace = dict(router=APIRouter(), Depends=Depends, get_admin_user=self.check_admin, User=object)
        exec(compile(ast.Module(body=[function], type_ignores=[]), "admin_users.py", "exec"), namespace)
        route = namespace["router"].routes[0]
        self.assertEqual(route.path, "/access-check")
        self.assertIn(self.check_admin, [d.call for d in route.dependant.dependencies])


if __name__ == "__main__":
    unittest.main()
