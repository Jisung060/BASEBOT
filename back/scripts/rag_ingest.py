from pathlib import Path

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings


DATA_PATH = Path("./rag_data")
CHROMA_PATH = "./chroma_db"


embedding = GoogleGenerativeAIEmbeddings(
    model="models/gemini-embedding-001"
)


documents = []


for file_path in DATA_PATH.glob("*.txt"):

    text = file_path.read_text(
        encoding="utf-8"
    )

    documents.append(
        Document(
            page_content=text,
            metadata={
                "source": file_path.name,
            }
        )
    )


splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50
)


split_documents = splitter.split_documents(
    documents
)


Chroma.from_documents(
    documents=split_documents,
    embedding=embedding,
    collection_name="basebot",
    persist_directory=CHROMA_PATH
)


print("BASEBOT RAG 데이터 등록 완료")
print(f"원본 문서 수: {len(documents)}")
print(f"분할 문서 수: {len(split_documents)}")