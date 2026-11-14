package br.com.alocca.plantoes

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** IDs publicados por conta, duráveis e sem expurgo de itens ainda não lidos. */
internal class PublicacoesNotificacao(context: Context) : SQLiteOpenHelper(context, "notificacoes_publicadas.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE publicadas (conta TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(conta,id))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    fun contem(conta: String, id: String): Boolean = readableDatabase.rawQuery(
        "SELECT 1 FROM publicadas WHERE conta=? AND id=?", arrayOf(conta, id),
    ).use { it.moveToFirst() }
    fun registrar(conta: String, id: String) {
        val valores = ContentValues().apply { put("conta", conta); put("id", id) }
        writableDatabase.insertWithOnConflict("publicadas", null, valores, SQLiteDatabase.CONFLICT_IGNORE)
    }
}
