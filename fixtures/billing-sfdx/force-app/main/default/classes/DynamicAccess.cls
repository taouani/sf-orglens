/**
 * Reaches fields by name at run time.
 */
public with sharing class DynamicAccess {
    public static Object riskScore(Account account) {
        return account.get('Risk_Score__c');
    }

    public static Object fieldOf(SObject record) {
        return record.get('Risk_Score__c');
    }

    public static void setLegacyCode(Invoice__c invoice, String code) {
        invoice.put(InvoiceConstants.FIELD_LEGACY, code);
    }

    public static String legacyCode(Invoice__c invoice) {
        return (String) invoice.get(InvoiceConstants.FIELD_LEGACY);
    }

    public static Object valueOf(Invoice__c invoice, String fieldName) {
        return invoice.get(fieldName);
    }

    public static void copyField(SObject source, SObject target, String fieldName) {
        Object value = source.get(fieldName);
        target.put(fieldName, value);
    }

    public static Object amountByToken(Invoice__c invoice) {
        return invoice.get(InvoiceConstants.AMOUNT);
    }

    public static Boolean canReadAmount() {
        return Schema.SObjectType.Invoice__c.fields.Amount__c.isAccessible();
    }

    public static Schema.SObjectField tokenByName(String fieldName) {
        return Schema.SObjectType.Invoice__c.fields.getMap().get(fieldName);
    }

    public static Schema.DescribeFieldResult statusDescribe() {
        Schema.SObjectType invoiceType = Schema.getGlobalDescribe().get(InvoiceConstants.OBJECT_INVOICE);
        Map<String, Schema.SObjectField> fields = invoiceType.getDescribe().fields.getMap();
        return fields.get(InvoiceConstants.FIELD_STATUS).getDescribe();
    }

    public static void setRiskScore(Account account, Decimal score) {
        account.put('Risk_Score__c', score);
    }

    public static void setAmountByToken(Invoice__c invoice, Decimal amount) {
        invoice.put(InvoiceConstants.AMOUNT, amount);
    }
}
