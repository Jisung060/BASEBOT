from pydantic import BaseModel


class CommunityPostCreate(BaseModel):

    category: str

    related_team_code: str | None = None

    title: str

    content: str


class CommunityPostUpdate(BaseModel):

    category: str

    related_team_code: str | None = None

    title: str

    content: str