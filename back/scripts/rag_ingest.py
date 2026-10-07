from pathlib import Path

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_google_genai import GoogleGenerativeAIEmbeddings

DATA_PATH = Path("./rag_data")
CHROMA_PATH = "./chroma_db"

embedding = GoogleGenerativeAIEmbeddings(
    model="models/gemini-embedding-001"
)

document = []

for file_path in DATA_PATH.glob("*.txt"):

    text = file_path.read_text(encoding="utf-8")

    document.append(
        Document(
            page_content=text,
            metadata={
                "source": file_path.name,
            }
        )
    )

Chroma.from_document(
    document=document,
    embedding=embedding,
    collection_name="basebot",
    persist_directory=CHROMA_PATH
)

print("BASEBOT RAG 데이터 등록 완료")