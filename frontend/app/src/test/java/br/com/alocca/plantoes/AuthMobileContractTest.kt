package br.com.alocca.plantoes

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthMobileContractTest {
    @Test fun `challenge requires opaque token 2fa and lifetime and no session`() {
        val valid = JSONObject().put("challenge_token", "opaque").put("requer_2fa", true).put("expires_in", 300)
        fun interpret(body: JSONObject) = AuthApi.interpretarChallenge(ApiResult(true, body, "", 200)).successful
        assertTrue(interpret(valid))
        assertFalse(interpret(JSONObject(valid.toString()).put("requer_2fa", false)))
        assertFalse(interpret(JSONObject(valid.toString()).put("expires_in", 0)))
        assertFalse(interpret(JSONObject(valid.toString()).put("access_token", "premature")))
        assertFalse(interpret(JSONObject(valid.toString()).put("refresh_token", "premature")))
    }

    @Test fun `failed response remains a failure`() {
        val result = AuthApi.interpretarChallenge(ApiResult(false, null, "offline", 0))
        assertFalse(result.successful)
        assertTrue(result.message == "offline")
    }
}
