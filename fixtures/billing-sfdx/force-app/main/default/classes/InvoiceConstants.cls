/**
 * Names of fields and objects that other classes use as text, and field tokens.
 */
public with sharing class InvoiceConstants {
    public static final String FIELD_LEGACY = 'Legacy_Code__c';
    public static final String FIELD_STATUS = 'Status__c';
    public static final String OBJECT_INVOICE = 'Invoice__c';
    public static final String STATUS_PAID = 'Paid';
    public static final String STATUS_DRAFT = 'Draft';
    public static final List<String> SUMMARY_FIELDS = new List<String>{ 'Amount__c', 'Tax_Rate__c' };
    public static final Schema.SObjectField AMOUNT = Invoice__c.Amount__c;
    public static final Schema.SObjectField EXTERNAL_ID = Invoice__c.External_Id__c;
    public static final Schema.SObjectType INVOICE_TYPE = Invoice__c.SObjectType;
}
